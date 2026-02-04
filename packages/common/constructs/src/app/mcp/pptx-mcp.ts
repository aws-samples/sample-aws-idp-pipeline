import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PptxMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
}

export class PptxMcp extends Construct {
  public readonly function: PythonFunction;

  constructor(scope: Construct, id: string, props: PptxMcpProps) {
    super(scope, id);

    const { backendTable, storageBucket } = props;

    const pptxMcpPath = path.resolve(
      process.cwd(),
      '../../packages/lambda/pptx-mcp',
    );

    this.function = new PythonFunction(this, 'PptxFunction', {
      functionName: 'idp-mcp-pptx',
      runtime: Runtime.PYTHON_3_13,
      architecture: Architecture.X86_64,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      entry: pptxMcpPath,
      index: 'src/handler.py',
      handler: 'handler',
      environment: {
        BACKEND_TABLE_NAME: backendTable.tableName,
        AGENT_STORAGE_BUCKET: storageBucket.bucketName,
      },
    });

    // Grant read-only permissions (extract only, no create/edit)
    backendTable.grantReadData(this.function);
    storageBucket.grantRead(this.function);
  }
}
