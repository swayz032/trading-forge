import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as events from "aws-cdk-lib/aws-events";
import * as targets from "aws-cdk-lib/aws-events-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as sns from "aws-cdk-lib/aws-sns";
import { Construct } from "constructs";

export class DataFetchStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const bucket = s3.Bucket.fromBucketName(this, "DataBucket", "trading-forge-data");

    const failureTopic = new sns.Topic(this, "DataFetchFailures", {
      topicName: "trading-forge-data-fetch-failures",
    });

    const fn = new lambda.Function(this, "NightlyDataFetch", {
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: "handler.handler",
      code: lambda.Code.fromAsset("../../infra/lambda/nightly-data-fetch"),
      memorySize: 512,
      timeout: cdk.Duration.minutes(15),
      environment: {
        S3_BUCKET: "trading-forge-data",
        SYMBOLS: "ES,NQ,CL",
        SNS_TOPIC_ARN: failureTopic.topicArn,
        BRAVE_API_KEY: process.env.BRAVE_API_KEY || "",
        BRAVE_SEARCH_API_KEY: process.env.BRAVE_SEARCH_API_KEY || "",
        N8N_API_KEY: process.env.N8N_API_KEY || "",
      },
    });

    bucket.grantReadWrite(fn);
    failureTopic.grantPublish(fn);

    new events.Rule(this, "NightlySchedule", {
      schedule: events.Schedule.expression("cron(0 7 ? * MON-FRI *)"),
      targets: [new targets.LambdaFunction(fn)],
    });
  }
}
