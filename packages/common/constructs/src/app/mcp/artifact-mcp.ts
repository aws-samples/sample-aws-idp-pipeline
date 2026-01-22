import { Duration } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ArtifactMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
}

export class ArtifactMcp extends Construct {
  public readonly saveFunction: NodejsFunction;
  public readonly loadFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ArtifactMcpProps) {
    super(scope, id);

    const { backendTable, storageBucket } = props;

    const commonEnv = {
      BACKEND_TABLE_NAME: backendTable.tableName,
      AGENT_STORAGE_BUCKET: storageBucket.bucketName,
    };

    // Save Artifact Function
    this.saveFunction = new NodejsFunction(this, 'SaveFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/artifact-mcp/src/save_artifact.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: commonEnv,
    });

    backendTable.grantWriteData(this.saveFunction);
    storageBucket.grantPut(this.saveFunction);

    // Load Artifact Function
    this.loadFunction = new NodejsFunction(this, 'LoadFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/artifact-mcp/src/load_artifact.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: commonEnv,
    });

    backendTable.grantReadData(this.loadFunction);
    storageBucket.grantRead(this.loadFunction);
  }
}
