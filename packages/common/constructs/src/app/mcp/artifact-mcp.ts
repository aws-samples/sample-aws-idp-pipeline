import { Duration, Stack } from 'aws-cdk-lib';
import { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface ArtifactMcpProps {
  backendTable: ITable;
  storageBucket: IBucket;
  vpc: IVpc;
  elasticacheEndpoint: string;
  websocketCallbackUrl: string;
  websocketApiId: string;
}

export class ArtifactMcp extends Construct {
  public readonly saveFunction: NodejsFunction;
  public readonly loadFunction: NodejsFunction;
  public readonly editFunction: NodejsFunction;

  constructor(scope: Construct, id: string, props: ArtifactMcpProps) {
    super(scope, id);

    const {
      backendTable,
      storageBucket,
      vpc,
      elasticacheEndpoint,
      websocketCallbackUrl,
      websocketApiId,
    } = props;
    const stack = Stack.of(this);

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
      vpc,
      environment: {
        ...commonEnv,
        ELASTICACHE_ENDPOINT: elasticacheEndpoint,
        WEBSOCKET_CALLBACK_URL: websocketCallbackUrl,
      },
      bundling: {
        nodeModules: ['iovalkey'],
      },
    });

    backendTable.grantWriteData(this.saveFunction);
    storageBucket.grantPut(this.saveFunction);
    this.saveFunction.addToRolePolicy(
      new PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [
          `arn:aws:execute-api:${stack.region}:${stack.account}:${websocketApiId}/*/@connections/*`,
        ],
      }),
    );

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

    // Edit Artifact Function
    this.editFunction = new NodejsFunction(this, 'EditFunction', {
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/artifact-mcp/src/edit_artifact.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      environment: commonEnv,
    });

    backendTable.grantReadWriteData(this.editFunction);
    storageBucket.grantPut(this.editFunction);
  }
}
