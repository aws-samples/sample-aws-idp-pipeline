import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { IQueue } from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';
import * as path from 'path';

export interface DocxMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
  websocketMessageQueue: IQueue;
}

export class DocxMcp extends Construct {
  public readonly function: PythonFunction;

  constructor(scope: Construct, id: string, props: DocxMcpProps) {
    super(scope, id);

    const { backendTable, storageBucket, websocketMessageQueue } = props;

    const docxMcpPath = path.resolve(
      process.cwd(),
      '../../packages/lambda/docx-mcp',
    );

    this.function = new PythonFunction(this, 'DocxFunction', {
      functionName: 'idp-mcp-docx',
      runtime: Runtime.PYTHON_3_13,
      architecture: Architecture.X86_64,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      entry: docxMcpPath,
      index: 'src/handler.py',
      handler: 'handler',
      environment: {
        BACKEND_TABLE_NAME: backendTable.tableName,
        AGENT_STORAGE_BUCKET: storageBucket.bucketName,
        WEBSOCKET_MESSAGE_QUEUE_URL: websocketMessageQueue.queueUrl,
      },
    });

    // Grant permissions for all operations
    backendTable.grantReadWriteData(this.function);
    storageBucket.grantReadWrite(this.function);
    websocketMessageQueue.grantSendMessages(this.function);
  }
}
