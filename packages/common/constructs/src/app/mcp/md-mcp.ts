import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface MdMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
  websocketMessageQueue: IQueue;
}

export class MdMcp extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: MdMcpProps) {
    super(scope, id);

    const { backendTable, storageBucket, websocketMessageQueue } = props;

    this.function = new NodejsFunction(this, 'Function', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/md-mcp/src/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: {
        BACKEND_TABLE_NAME: backendTable.tableName,
        AGENT_STORAGE_BUCKET: storageBucket.bucketName,
        WEBSOCKET_MESSAGE_QUEUE_URL: websocketMessageQueue.queueUrl,
      },
    });

    backendTable.grantReadWriteData(this.function);
    storageBucket.grantReadWrite(this.function);
    websocketMessageQueue.grantSendMessages(this.function);
  }
}
