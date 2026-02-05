import { Duration } from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { S3EventSourceV2 } from 'aws-cdk-lib/aws-lambda-event-sources';
import { IBucket, EventType } from 'aws-cdk-lib/aws-s3';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ArtifactProcessProps {
  bucket: IBucket;
  table: ITable;
  vpc: IVpc;
  websocketMessageQueue: IQueue;
}

export class ArtifactProcess extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: ArtifactProcessProps) {
    super(scope, id);

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/session_workers/src/artifact_process/index.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      vpc: props.vpc,
      environment: {
        BACKEND_TABLE_NAME: props.table.tableName,
        WEBSOCKET_MESSAGE_QUEUE_URL: props.websocketMessageQueue.queueUrl,
      },
    });

    props.bucket.grantRead(this.function);
    props.table.grantWriteData(this.function);
    props.websocketMessageQueue.grantSendMessages(this.function);

    // Filter by artifacts path - Lambda will check for /artifacts/ in key
    this.function.addEventSource(
      new S3EventSourceV2(props.bucket, {
        events: [EventType.OBJECT_CREATED],
      }),
    );
  }
}
