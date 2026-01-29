import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { PythonFunction } from '@aws-cdk/aws-lambda-python-alpha';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface PdfMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
}

export class PdfMcp extends Construct {
  public readonly function: PythonFunction;

  constructor(scope: Construct, id: string, props: PdfMcpProps) {
    super(scope, id);

    const { backendTable, storageBucket } = props;

    const pdfMcpPath = path.resolve(
      process.cwd(),
      '../../packages/lambda/pdf-mcp',
    );

    this.function = new PythonFunction(this, 'PdfFunction', {
      functionName: 'idp-mcp-pdf',
      runtime: Runtime.PYTHON_3_13,
      architecture: Architecture.X86_64,
      timeout: Duration.minutes(5),
      memorySize: 1024,
      entry: pdfMcpPath,
      index: 'src/handler.py',
      handler: 'handler',
      environment: {
        BACKEND_TABLE_NAME: backendTable.tableName,
        AGENT_STORAGE_BUCKET: storageBucket.bucketName,
      },
    });

    // Grant permissions for all operations
    backendTable.grantReadWriteData(this.function);
    storageBucket.grantReadWrite(this.function);
  }
}
