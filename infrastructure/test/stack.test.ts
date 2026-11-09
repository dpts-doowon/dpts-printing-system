import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { InfraConfigError, parseConfig } from "../lib/config.js";
import { HomologStack } from "../lib/homolog-stack.js";

const ctx = {
  account: "123456789012",
  region: "sa-east-1",
  allowedCidrs: "10.20.0.0/16",
  certificateArn: "arn:aws:acm:sa-east-1:123456789012:certificate/abc-123",
  apiHost: "api.rastreabilidade.exemplo.local",
  webHost: "app.rastreabilidade.exemplo.local",
};

const synth = (over: Record<string, unknown> = {}) => {
  const cfg = parseConfig({ ...ctx, ...over });
  const stack = new HomologStack(new App(), "T", {
    cfg,
    env: { account: cfg.account, region: cfg.region },
  });
  return Template.fromStack(stack);
};

describe("configuração", () => {
  it("não tem padrão para o que depende de decisão da Doowon", () => {
    try {
      parseConfig({});
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(InfraConfigError);
      for (const k of ["account", "region", "allowedCidrs", "certificateArn", "apiHost", "webHost"])
        expect((e as Error).message).toContain(`"${k}"`);
    }
  });
  it("recusa 0.0.0.0/0 com exposição interna, 'latest' e valores inválidos", () => {
    expect(() => parseConfig({ ...ctx, allowedCidrs: "0.0.0.0/0" })).toThrow(/internal/);
    expect(() => parseConfig({ ...ctx, imageTag: "latest" })).toThrow(/latest/);
    expect(() => parseConfig({ ...ctx, allowedCidrs: "10.0.0.0/33" })).toThrow(/CIDR/);
    expect(() => parseConfig({ ...ctx, logRetentionDays: 31 })).toThrow(/CloudWatch/);
    expect(() => parseConfig({ ...ctx, webHost: ctx.apiHost })).toThrow(/diferentes/);
  });
  it("aceita 0.0.0.0/0 apenas quando a exposição é 'internet' (decisão explícita)", () => {
    expect(() =>
      parseConfig({ ...ctx, exposure: "internet", allowedCidrs: "0.0.0.0/0" }),
    ).not.toThrow();
  });
});

describe("infraestrutura de homologação", () => {
  const t = synth();

  it("o banco é criptografado, privado, protegido contra exclusão e exige TLS", () => {
    t.hasResourceProperties("AWS::RDS::DBInstance", {
      Engine: "postgres",
      StorageEncrypted: true,
      PubliclyAccessible: false,
      DeletionProtection: true,
      BackupRetentionPeriod: 7,
      MultiAZ: false,
    });
    t.hasResourceProperties("AWS::RDS::DBParameterGroup", {
      Parameters: Match.objectLike({ "rds.force_ssl": "1" }),
    });
    t.hasResource("AWS::RDS::DBInstance", { DeletionPolicy: "Snapshot" });
  });

  it("o banco só recebe conexões dos serviços", () => {
    const rules = t.findResources("AWS::EC2::SecurityGroupIngress");
    const toDb = Object.values(rules).filter((r) => r.Properties.FromPort === 5432);
    expect(toDb).toHaveLength(1);
    expect(toDb[0]!.Properties.SourceSecurityGroupId).toBeDefined();
  });

  it("nenhum grupo de segurança aceita entrada de 0.0.0.0/0 e o ALB é interno por padrão", () => {
    const rules = Object.values(t.findResources("AWS::EC2::SecurityGroupIngress"));
    expect(rules.some((r) => r.Properties.CidrIp === "0.0.0.0/0")).toBe(false);
    const ingress = Object.values(t.findResources("AWS::EC2::SecurityGroup")).flatMap(
      (r) => r.Properties.SecurityGroupIngress ?? [],
    );
    expect(
      ingress.every(
        (i: { CidrIp?: string }) => i.CidrIp === undefined || i.CidrIp === "10.20.0.0/16",
      ),
    ).toBe(true);
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", { Scheme: "internal" });
  });

  it("HTTP redireciona para HTTPS e o HTTPS usa o certificado informado", () => {
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 80,
      DefaultActions: [
        Match.objectLike({
          Type: "redirect",
          RedirectConfig: Match.objectLike({ Protocol: "HTTPS" }),
        }),
      ],
    });
    t.hasResourceProperties("AWS::ElasticLoadBalancingV2::Listener", {
      Port: 443,
      Certificates: [{ CertificateArn: ctx.certificateArn }],
    });
  });

  it("nenhum segredo vai em variável de ambiente em claro", () => {
    const tasks = Object.values(t.findResources("AWS::ECS::TaskDefinition"));
    for (const task of tasks)
      for (const c of task.Properties.ContainerDefinitions) {
        const names = (c.Environment ?? []).map((e: { Name: string }) => e.Name);
        expect(names.filter((n: string) => /PASSWORD|TOKEN|SECRET/.test(n))).toEqual([]);
      }
    const api = tasks.find((x) => x.Properties.ContainerDefinitions[0].Name === "api")!;
    const secretNames = api.Properties.ContainerDefinitions[0].Secrets.map(
      (s: { Name: string }) => s.Name,
    );
    expect(secretNames).toEqual(
      expect.arrayContaining(["PGPASSWORD", "SEED_ADMIN_PASSWORD", "AGENT_TOKEN_ST1"]),
    );
  });

  it("serviços em sub-rede privada, sem IP público, com reversão automática", () => {
    t.hasResourceProperties("AWS::ECS::Service", {
      LaunchType: "FARGATE",
      NetworkConfiguration: {
        AwsvpcConfiguration: Match.objectLike({ AssignPublicIp: "DISABLED" }),
      },
      DeploymentConfiguration: Match.objectLike({
        DeploymentCircuitBreaker: { Enable: true, Rollback: true },
      }),
    });
  });

  it("imagens imutáveis com varredura, logs com retenção e alarmes ligados a um tópico", () => {
    t.hasResourceProperties("AWS::ECR::Repository", {
      ImageTagMutability: "IMMUTABLE",
      ImageScanningConfiguration: { ScanOnPush: true },
    });
    for (const lg of Object.values(t.findResources("AWS::Logs::LogGroup")))
      expect(lg.Properties.RetentionInDays).toBe(30);
    expect(Object.keys(t.findResources("AWS::CloudWatch::Alarm")).length).toBeGreaterThanOrEqual(6);
  });

  it("a exposição pública exige escolha explícita", () => {
    const pub = synth({ exposure: "internet", allowedCidrs: "203.0.113.0/24" });
    pub.hasResourceProperties("AWS::ElasticLoadBalancingV2::LoadBalancer", {
      Scheme: "internet-facing",
    });
  });
});
