import { App, Tags } from "aws-cdk-lib";
import { parseConfig } from "../lib/config.js";
import { HomologStack } from "../lib/homolog-stack.js";

const app = new App();
const cfg = parseConfig({
  ...Object.fromEntries(
    [
      "account",
      "region",
      "exposure",
      "allowedCidrs",
      "certificateArn",
      "apiHost",
      "webHost",
      "imageTag",
      "natGateways",
      "dbInstanceClass",
      "dbMultiAz",
      "dbBackupDays",
      "dbAllocatedStorageGb",
      "logRetentionDays",
      "apiDesiredCount",
      "webDesiredCount",
      "alarmEmail",
    ].map((k) => [k, app.node.tryGetContext(k)]),
  ),
});

const stack = new HomologStack(app, "DoowonTraceabilityHomolog", {
  cfg,
  env: { account: cfg.account, region: cfg.region },
  description: "D-PTS | Doowon Part Tracking System (homologação)",
});
Tags.of(stack).add("Project", "doowon-traceability");
Tags.of(stack).add("Environment", "homolog");
Tags.of(stack).add("ManagedBy", "cdk");
