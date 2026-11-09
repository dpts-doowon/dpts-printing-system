import {
  CfnOutput,
  Duration,
  RemovalPolicy,
  Stack,
  type StackProps,
  aws_cloudwatch as cw,
  aws_cloudwatch_actions as cwActions,
  aws_ec2 as ec2,
  aws_ecr as ecr,
  aws_ecs as ecs,
  aws_elasticloadbalancingv2 as elbv2,
  aws_kms as kms,
  aws_logs as logs,
  aws_rds as rds,
  aws_s3 as s3,
  aws_secretsmanager as secrets,
  aws_sns as sns,
  aws_sns_subscriptions as subs,
} from "aws-cdk-lib";
import type { Construct } from "constructs";
import type { InfraConfig } from "./config.js";

export interface HomologStackProps extends StackProps {
  cfg: InfraConfig;
}

/**
 * Esqueleto da infraestrutura de HOMOLOGAÇÃO (nada foi implantado; depende de D-002 a D-004).
 *
 * Princípios: banco isolado (sem rota para a internet) e criptografado; serviços em sub-redes privadas;
 * única entrada pelo ALB, restrita às faixas informadas; segredos no Secrets Manager (nunca em variáveis
 * em claro); logs com retenção definida; alarmes básicos. Esta composição usa os dados de partida
 * PROVISÓRIOS de desenvolvimento da API; a composição de produção (cadastro seguro do agente, D-027,
 * criação do primeiro administrador) é uma fatia futura, e por isso não há ambiente "prod" aqui.
 */
export class HomologStack extends Stack {
  constructor(scope: Construct, id: string, props: HomologStackProps) {
    super(scope, id, props);
    const { cfg } = props;
    const internal = cfg.exposure === "internal";

    const key = new kms.Key(this, "DataKey", {
      enableKeyRotation: true,
      description: "Chave de criptografia (banco, segredos, logs)",
    });

    // ---------- Rede ----------
    const vpc = new ec2.Vpc(this, "Vpc", {
      maxAzs: 2,
      natGateways: cfg.natGateways,
      subnetConfiguration: [
        { name: "public", subnetType: ec2.SubnetType.PUBLIC, cidrMask: 24 },
        { name: "app", subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, cidrMask: 24 },
        { name: "data", subnetType: ec2.SubnetType.PRIVATE_ISOLATED, cidrMask: 24 },
      ],
    });
    vpc.addFlowLog("FlowLog", {
      destination: ec2.FlowLogDestination.toCloudWatchLogs(
        new logs.LogGroup(this, "FlowLogs", {
          retention: cfg.logRetentionDays as logs.RetentionDays,
          encryptionKey: key,
          removalPolicy: RemovalPolicy.RETAIN,
        }),
      ),
      trafficType: ec2.FlowLogTrafficType.REJECT,
    });

    const albSg = new ec2.SecurityGroup(this, "AlbSg", {
      vpc,
      description: "ALB",
      allowAllOutbound: false,
    });
    for (const c of cfg.allowedCidrs) {
      albSg.addIngressRule(ec2.Peer.ipv4(c), ec2.Port.tcp(443), "HTTPS");
      albSg.addIngressRule(ec2.Peer.ipv4(c), ec2.Port.tcp(80), "HTTP (redireciona para HTTPS)");
    }
    const appSg = new ec2.SecurityGroup(this, "AppSg", { vpc, description: "Servicos API e Web" });
    const dbSg = new ec2.SecurityGroup(this, "DbSg", {
      vpc,
      description: "Banco",
      allowAllOutbound: false,
    });
    albSg.addEgressRule(appSg, ec2.Port.tcp(3001), "ALB -> API");
    albSg.addEgressRule(appSg, ec2.Port.tcp(3000), "ALB -> Web");
    appSg.addIngressRule(albSg, ec2.Port.tcp(3001), "API a partir do ALB");
    appSg.addIngressRule(albSg, ec2.Port.tcp(3000), "Web a partir do ALB");
    dbSg.addIngressRule(appSg, ec2.Port.tcp(5432), "PostgreSQL a partir dos servicos");

    // ---------- Banco ----------
    const db = new rds.DatabaseInstance(this, "Db", {
      engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
      instanceType: new ec2.InstanceType(cfg.dbInstanceClass),
      allocatedStorage: cfg.dbAllocatedStorageGb,
      maxAllocatedStorage: cfg.dbAllocatedStorageGb * 5,
      storageType: rds.StorageType.GP3,
      storageEncrypted: true,
      storageEncryptionKey: key,
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [dbSg],
      publiclyAccessible: false,
      multiAz: cfg.dbMultiAz,
      databaseName: "traceability",
      credentials: rds.Credentials.fromGeneratedSecret("app", { encryptionKey: key }),
      backupRetention: Duration.days(cfg.dbBackupDays),
      deletionProtection: true,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      copyTagsToSnapshot: true,
      autoMinorVersionUpgrade: true,
      parameterGroup: new rds.ParameterGroup(this, "DbParams", {
        engine: rds.DatabaseInstanceEngine.postgres({ version: rds.PostgresEngineVersion.VER_16 }),
        parameters: { "rds.force_ssl": "1", log_min_duration_statement: "1000" },
      }),
      cloudwatchLogsExports: ["postgresql"],
      cloudwatchLogsRetention: cfg.logRetentionDays as logs.RetentionDays,
    });

    // ---------- Segredos de partida (homologação, gerados pela AWS) ----------
    const agentToken1 = new secrets.Secret(this, "AgentTokenSt1", {
      description: "Token do agente do Posto 01 (homologação)",
      encryptionKey: key,
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    const agentToken2 = new secrets.Secret(this, "AgentTokenSt2", {
      description: "Token do agente do Posto 02 (homologação)",
      encryptionKey: key,
      generateSecretString: { passwordLength: 40, excludePunctuation: true },
    });
    const adminPw = new secrets.Secret(this, "AdminPassword", {
      description: "Senha inicial do administrador (homologação; trocar após o primeiro acesso)",
      encryptionKey: key,
      generateSecretString: { passwordLength: 24, excludePunctuation: true },
    });
    const operatorPw = new secrets.Secret(this, "OperatorPassword", {
      description: "Senha inicial dos operadores de teste (homologação)",
      encryptionKey: key,
      generateSecretString: { passwordLength: 24, excludePunctuation: true },
    });

    // ---------- Imagens e cluster ----------
    const repo = (name: string): ecr.Repository =>
      new ecr.Repository(this, `Repo-${name}`, {
        repositoryName: `doowon-traceability/${name}`,
        imageTagMutability: ecr.TagMutability.IMMUTABLE,
        imageScanOnPush: true,
        encryption: ecr.RepositoryEncryption.KMS,
        encryptionKey: key,
        removalPolicy: RemovalPolicy.RETAIN,
        lifecycleRules: [{ maxImageCount: 20 }],
      });
    const apiRepo = repo("api");
    const webRepo = repo("web");

    const cluster = new ecs.Cluster(this, "Cluster", {
      vpc,
      containerInsightsV2: ecs.ContainerInsights.ENABLED,
    });
    const logGroup = (name: string): logs.LogGroup =>
      new logs.LogGroup(this, `Logs-${name}`, {
        retention: cfg.logRetentionDays as logs.RetentionDays,
        encryptionKey: key,
        removalPolicy: RemovalPolicy.RETAIN,
      });

    const apiTask = new ecs.FargateTaskDefinition(this, "ApiTask", {
      cpu: 512,
      memoryLimitMiB: 1024,
    });
    apiTask.addContainer("api", {
      image: ecs.ContainerImage.fromEcrRepository(apiRepo, cfg.imageTag),
      portMappings: [{ containerPort: 3001 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "api", logGroup: logGroup("api") }),
      environment: {
        API_PORT: "3001",
        PGSSLMODE: "require",
        WEB_ORIGIN: `https://${cfg.webHost}`,
      },
      secrets: {
        PGHOST: ecs.Secret.fromSecretsManager(db.secret!, "host"),
        PGPORT: ecs.Secret.fromSecretsManager(db.secret!, "port"),
        PGUSER: ecs.Secret.fromSecretsManager(db.secret!, "username"),
        PGPASSWORD: ecs.Secret.fromSecretsManager(db.secret!, "password"),
        PGDATABASE: ecs.Secret.fromSecretsManager(db.secret!, "dbname"),
        SEED_ADMIN_PASSWORD: ecs.Secret.fromSecretsManager(adminPw),
        SEED_OPERATOR_PASSWORD: ecs.Secret.fromSecretsManager(operatorPw),
        AGENT_TOKEN_ST1: ecs.Secret.fromSecretsManager(agentToken1),
        AGENT_TOKEN_ST2: ecs.Secret.fromSecretsManager(agentToken2),
      },
      healthCheck: {
        command: [
          "CMD-SHELL",
          "node -e \"fetch('http://localhost:3001/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))\"",
        ],
        interval: Duration.seconds(30),
        timeout: Duration.seconds(5),
        retries: 3,
        startPeriod: Duration.seconds(30),
      },
    });

    const webTask = new ecs.FargateTaskDefinition(this, "WebTask", {
      cpu: 256,
      memoryLimitMiB: 512,
    });
    webTask.addContainer("web", {
      image: ecs.ContainerImage.fromEcrRepository(webRepo, cfg.imageTag),
      portMappings: [{ containerPort: 3000 }],
      logging: ecs.LogDrivers.awsLogs({ streamPrefix: "web", logGroup: logGroup("web") }),
    });

    const service = (
      name: string,
      task: ecs.FargateTaskDefinition,
      count: number,
    ): ecs.FargateService =>
      new ecs.FargateService(this, `Svc-${name}`, {
        cluster,
        taskDefinition: task,
        desiredCount: count,
        securityGroups: [appSg],
        vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
        assignPublicIp: false,
        circuitBreaker: { rollback: true },
        minHealthyPercent: 100,
        maxHealthyPercent: 200,
        enableExecuteCommand: false,
      });
    const apiSvc = service("api", apiTask, cfg.apiDesiredCount);
    const webSvc = service("web", webTask, cfg.webDesiredCount);

    // ---------- ALB ----------
    const logsBucket = new s3.Bucket(this, "AlbLogs", {
      encryption: s3.BucketEncryption.S3_MANAGED, // o ALB não grava em bucket com chave KMS própria
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      versioned: false,
      lifecycleRules: [{ expiration: Duration.days(cfg.logRetentionDays) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const alb = new elbv2.ApplicationLoadBalancer(this, "Alb", {
      vpc,
      internetFacing: !internal,
      vpcSubnets: {
        subnetType: internal ? ec2.SubnetType.PRIVATE_WITH_EGRESS : ec2.SubnetType.PUBLIC,
      },
      securityGroup: albSg,
      dropInvalidHeaderFields: true,
      deletionProtection: true,
    });
    alb.logAccessLogs(logsBucket);

    const https = alb.addListener("Https", {
      open: false, // o padrão do CDK abriria para 0.0.0.0/0; o acesso é só pelas faixas informadas
      port: 443,
      certificates: [{ certificateArn: cfg.certificateArn }],
      sslPolicy: elbv2.SslPolicy.RECOMMENDED_TLS,
      defaultAction: elbv2.ListenerAction.fixedResponse(404, {
        contentType: "text/plain",
        messageBody: "Not found",
      }),
    });
    alb.addListener("Http", {
      open: false,
      port: 80,
      defaultAction: elbv2.ListenerAction.redirect({
        protocol: "HTTPS",
        port: "443",
        permanent: true,
      }),
    });
    const apiTg = https.addTargets("Api", {
      priority: 10,
      conditions: [elbv2.ListenerCondition.hostHeaders([cfg.apiHost])],
      port: 3001,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [apiSvc],
      healthCheck: { path: "/health", healthyHttpCodes: "200", interval: Duration.seconds(30) },
      deregistrationDelay: Duration.seconds(30),
    });
    const webTg = https.addTargets("Web", {
      priority: 20,
      conditions: [elbv2.ListenerCondition.hostHeaders([cfg.webHost])],
      port: 3000,
      protocol: elbv2.ApplicationProtocol.HTTP,
      targets: [webSvc],
      healthCheck: { path: "/", healthyHttpCodes: "200", interval: Duration.seconds(30) },
      deregistrationDelay: Duration.seconds(30),
    });

    // ---------- Alarmes ----------
    const topic = new sns.Topic(this, "Alarms", {
      masterKey: key,
      displayName: "Alarmes - D-PTS (homologação)",
    });
    if (cfg.alarmEmail) topic.addSubscription(new subs.EmailSubscription(cfg.alarmEmail));
    const alarm = (
      id: string,
      metric: cw.IMetric,
      threshold: number,
      op: cw.ComparisonOperator,
      desc: string,
    ): void => {
      const a = new cw.Alarm(this, id, {
        metric,
        threshold,
        evaluationPeriods: 3,
        comparisonOperator: op,
        treatMissingData: cw.TreatMissingData.NOT_BREACHING,
        alarmDescription: desc,
      });
      a.addAlarmAction(new cwActions.SnsAction(topic));
    };
    alarm(
      "Api5xx",
      apiTg.metrics.httpCodeTarget(elbv2.HttpCodeTarget.TARGET_5XX_COUNT, {
        period: Duration.minutes(5),
      }),
      5,
      cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      "API retornando erros 5xx",
    );
    alarm(
      "ApiUnhealthy",
      apiTg.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      1,
      cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      "API sem instância saudável",
    );
    alarm(
      "WebUnhealthy",
      webTg.metrics.unhealthyHostCount({ period: Duration.minutes(1) }),
      1,
      cw.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      "Web sem instância saudável",
    );
    alarm(
      "DbCpu",
      db.metricCPUUtilization({ period: Duration.minutes(5) }),
      80,
      cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      "CPU do banco alta",
    );
    alarm(
      "DbStorage",
      db.metricFreeStorageSpace({ period: Duration.minutes(5) }),
      cfg.dbAllocatedStorageGb * 1024 ** 3 * 0.2,
      cw.ComparisonOperator.LESS_THAN_THRESHOLD,
      "Pouco espaço livre no banco",
    );
    alarm(
      "ApiCpu",
      apiSvc.metricCpuUtilization({ period: Duration.minutes(5) }),
      80,
      cw.ComparisonOperator.GREATER_THAN_THRESHOLD,
      "CPU da API alta",
    );

    // ---------- Saídas ----------
    new CfnOutput(this, "AlbDnsName", {
      value: alb.loadBalancerDnsName,
      description: "Aponte apiHost e webHost (CNAME/alias) para este nome",
    });
    new CfnOutput(this, "ApiRepositoryUri", { value: apiRepo.repositoryUri });
    new CfnOutput(this, "WebRepositoryUri", { value: webRepo.repositoryUri });
    new CfnOutput(this, "AdminPasswordSecretArn", { value: adminPw.secretArn });
    new CfnOutput(this, "OperatorPasswordSecretArn", { value: operatorPw.secretArn });
    new CfnOutput(this, "DbSecretArn", { value: db.secret!.secretArn });
  }
}
