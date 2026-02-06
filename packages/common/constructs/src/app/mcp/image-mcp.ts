import { Duration, Stack } from 'aws-cdk-lib';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { Runtime, Architecture } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { IBucket } from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';
import * as path from 'path';
import { SSM_KEYS } from '../../constants/ssm-keys.js';

export interface ImageMcpProps {
  storageBucket: IBucket;
}

export class ImageMcp extends Construct {
  public readonly function: NodejsFunction;

  constructor(scope: Construct, id: string, props: ImageMcpProps) {
    super(scope, id);

    const { storageBucket } = props;

    this.function = new NodejsFunction(this, 'Function', {
      functionName: 'idp-mcp-image',
      entry: path.resolve(
        process.cwd(),
        '../../packages/lambda/image-mcp/src/handler.ts',
      ),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      timeout: Duration.seconds(30),
      memorySize: 512,
      environment: {
        AGENT_STORAGE_BUCKET: storageBucket.bucketName,
        UNSPLASH_ACCESS_KEY_PARAM: SSM_KEYS.UNSPLASH_ACCESS_KEY,
      },
    });

    storageBucket.grantReadWrite(this.function);

    const stack = Stack.of(this);
    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['ssm:GetParameter'],
        resources: [
          `arn:aws:ssm:${stack.region}:${stack.account}:parameter/idp-v2/*`,
        ],
      }),
    );
  }
}
