#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import { DataFetchStack } from "../lib/data-fetch-stack";

const app = new cdk.App();
new DataFetchStack(app, "TradingForgeDataFetch", {
  env: { region: "us-east-1" },
});
