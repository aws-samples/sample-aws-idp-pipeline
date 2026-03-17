import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { RustFunction } from 'cargo-lambda-cdk';
import { SSM_KEYS } from ':idp-v2/common-constructs';

export class LanceServiceStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const tokaFunction = new RustFunction(this, 'TokaFunction', {
      functionName: 'idp-v2-toka',
      manifestPath: '../lambda/toka/Cargo.toml',
      memorySize: 1024,
    });

    new StringParameter(this, 'TokaFunctionNameParam', {
      parameterName: SSM_KEYS.TOKA_FUNCTION_NAME,
      stringValue: tokaFunction.functionName,
    });

    // LanceDB resources (from SSM)
    const lancedbExpressBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_EXPRESS_BUCKET_NAME,
    );
    const lancedbLockTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCEDB_LOCK_TABLE_NAME,
    );
    const lancedbLockTable = dynamodb.Table.fromTableName(
      this,
      'LanceDBLockTable',
      lancedbLockTableName,
    );

    // Dummy Lambda (actual binary deployed via CodeBuild)
    const lanceDbServiceFunction = new lambda.Function(
      this,
      'LanceDbServiceFunction',
      {
        functionName: 'idp-v2-lance-service',
        runtime: lambda.Runtime.PROVIDED_AL2023,
        architecture: lambda.Architecture.ARM_64,
        handler: 'bootstrap',
        code: lambda.Code.fromAsset('../lambda/lancedb-service/placeholder'),
        memorySize: 1024,
        timeout: Duration.minutes(5),
        environment: {
          TOKA_FUNCTION_NAME: tokaFunction.functionName,
          LANCEDB_EXPRESS_BUCKET_NAME: lancedbExpressBucketName,
          LANCEDB_LOCK_TABLE_NAME: lancedbLockTableName,
        },
      },
    );

    // Toka Lambda invoke
    tokaFunction.grantInvoke(lanceDbServiceFunction);

    // S3 Express One Zone (LanceDB storage)
    lanceDbServiceFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          's3express:CreateSession',
          's3:GetObject',
          's3:PutObject',
          's3:DeleteObject',
          's3:ListBucket',
        ],
        resources: [
          `arn:aws:s3express:${this.region}:${this.account}:bucket/${lancedbExpressBucketName}`,
          `arn:aws:s3express:${this.region}:${this.account}:bucket/${lancedbExpressBucketName}/*`,
        ],
      }),
    );

    // DynamoDB LanceDB Lock table
    lancedbLockTable.grantReadWriteData(lanceDbServiceFunction);

    // Bedrock (embeddings)
    lanceDbServiceFunction.addToRolePolicy(
      new iam.PolicyStatement({
        actions: [
          'bedrock:InvokeModel',
          'bedrock:InvokeModelWithResponseStream',
        ],
        resources: ['*'],
      }),
    );

    new StringParameter(this, 'LanceDbServiceFunctionArnParam', {
      parameterName: SSM_KEYS.LANCE_SERVICE_FUNCTION_ARN,
      stringValue: lanceDbServiceFunction.functionArn,
    });

    // CodeBuild project for building and deploying lancedb-service Rust binary
    const lanceDbBuildProject = new codebuild.Project(
      this,
      'LanceDbServiceBuild',
      {
        projectName: 'idp-v2-lancedb-service-build',
        description: 'Build lancedb-service Rust Lambda and deploy',
        environment: {
          buildImage:
            codebuild.LinuxArmBuildImage.AMAZON_LINUX_2023_STANDARD_3_0,
          computeType: codebuild.ComputeType.LARGE,
        },
        source: codebuild.Source.gitHub({
          owner: 'aws-samples',
          repo: 'sample-aws-idp-pipeline',
          branchOrRef: 'main',
        }),
        timeout: Duration.minutes(30),
        cache: codebuild.Cache.local(codebuild.LocalCacheMode.CUSTOM),
        buildSpec: codebuild.BuildSpec.fromObject({
          version: '0.2',
          phases: {
            install: {
              commands: [
                'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y',
                'source $HOME/.cargo/env',
                'pip install cargo-lambda',
              ],
            },
            build: {
              commands: [
                'cd packages/lambda/lancedb-service',
                'cargo lambda build --release --arm64',
              ],
            },
            post_build: {
              commands: [
                'cd packages/lambda/lancedb-service',
                'zip -j bootstrap.zip target/lambda/lancedb-service/bootstrap',
                `aws lambda update-function-code --function-name ${lanceDbServiceFunction.functionName} --zip-file fileb://bootstrap.zip`,
              ],
            },
          },
          cache: {
            paths: [
              '$HOME/.cargo/registry/**/*',
              '$HOME/.cargo/git/**/*',
              'packages/lambda/lancedb-service/target/**/*',
            ],
          },
        }),
      },
    );

    lanceDbBuildProject.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['lambda:UpdateFunctionCode'],
        resources: [lanceDbServiceFunction.functionArn],
      }),
    );
  }
}
