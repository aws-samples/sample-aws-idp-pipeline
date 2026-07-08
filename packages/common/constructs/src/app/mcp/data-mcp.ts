import { AssetHashType, Duration } from 'aws-cdk-lib';
import {
  Architecture,
  Code,
  Function as LambdaFunction,
  LayerVersion,
  Runtime,
} from 'aws-cdk-lib/aws-lambda';
import { Bucket } from 'aws-cdk-lib/aws-s3';
import { Table } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { SSM_KEYS } from '../../constants/ssm-keys.js';

const LAYER_PLATFORM = 'manylinux2014_aarch64';
// DuckDB publishes wheels only up to cp313 (no cp314 yet), so this Lambda pins
// to Python 3.13 independently of the other 3.14 functions.
const LAYER_PYTHON_VERSION = '3.13';
const PYTHON_RUNTIME = Runtime.PYTHON_3_13;

/**
 * Data MCP Lambda: exposes search_datasets / describe_dataset / run_sql over
 * project Parquet datasets. Python + DuckDB reads S3 Parquet (pyarrow + s3fs);
 * search_datasets delegates to the LanceDB service for the per-project catalog.
 */
export class DataMcp extends Construct {
  public readonly function: LambdaFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    const backendTableName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.BACKEND_TABLE_NAME,
    );
    const backendTable = Table.fromTableName(
      this,
      'BackendTable',
      backendTableName,
    );

    const documentStorageBucketName = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.DOCUMENT_STORAGE_BUCKET_NAME,
    );
    const documentStorageBucket = Bucket.fromBucketName(
      this,
      'DocumentStorageBucket',
      documentStorageBucketName,
    );

    // search_datasets hybrid-searches the per-project dataset catalog via the
    // LanceDB service Lambda.
    const lancedbFunctionArn = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.LANCE_SERVICE_FUNCTION_ARN,
    );

    // pyarrow + s3fs read the Parquet from S3 and hand an Arrow table to DuckDB,
    // avoiding DuckDB's httpfs extension (which fails to download on Lambda's
    // arm64 platform for the pinned DuckDB version).
    const duckdbLayer = new LayerVersion(this, 'DuckDbLayer', {
      layerVersionName: 'idp-v2-data-mcp-duckdb',
      description: 'DuckDB, pyarrow, s3fs for the Data MCP Lambda',
      compatibleRuntimes: [PYTHON_RUNTIME],
      compatibleArchitectures: [Architecture.ARM_64],
      code: this.createLayerCode(['duckdb', 'pyarrow', 's3fs'], 'data-mcp'),
    });

    this.function = new LambdaFunction(this, 'Function', {
      functionName: 'idp-v2-data-mcp',
      runtime: PYTHON_RUNTIME,
      architecture: Architecture.ARM_64,
      handler: 'index.handler',
      timeout: Duration.minutes(2),
      // 2 GB: pyarrow loads whole Parquet files into memory, and JOINs register
      // several datasets at once. Headroom for ~100k-row datasets and multi-table
      // queries (see MAX_TOTAL_ROWS guard in index.py). More memory also raises
      // the CPU share, speeding up DuckDB.
      memorySize: 2048,
      code: Code.fromAsset(
        path.resolve(process.cwd(), '../../packages/lambda/data-mcp'),
      ),
      layers: [duckdbLayer],
      environment: {
        BACKEND_TABLE_NAME: backendTableName,
        LANCEDB_FUNCTION_ARN: lancedbFunctionArn,
      },
    });

    this.function.addToRolePolicy(
      new PolicyStatement({
        actions: ['lambda:InvokeFunction'],
        resources: [lancedbFunctionArn],
      }),
    );

    backendTable.grantReadData(this.function);
    documentStorageBucket.grantRead(this.function);
  }

  /**
   * Build a Lambda layer by pip-installing manylinux arm64 wheels.
   * Mirrors the createLayerCode pattern in workflow-stack.ts.
   */
  private createLayerCode(packages: string[], layerName: string): Code {
    const quotedPackages = packages.map((p) => `'${p}'`).join(' ');
    const layerDir = path.resolve(
      process.cwd(),
      `../../packages/infra/src/lambda-layers/${layerName}`,
    );
    if (!fs.existsSync(layerDir)) {
      fs.mkdirSync(layerDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(layerDir, 'requirements.txt'),
      packages.join('\n'),
    );
    fs.writeFileSync(
      path.join(layerDir, '.platform'),
      `${LAYER_PLATFORM}\n${LAYER_PYTHON_VERSION}\n`,
    );

    const pipArgs =
      `--platform ${LAYER_PLATFORM} ` +
      `--python-version ${LAYER_PYTHON_VERSION} ` +
      `--implementation cp ` +
      `--only-binary=:all: ${quotedPackages}`;

    return Code.fromAsset(layerDir, {
      assetHashType: AssetHashType.SOURCE,
      bundling: {
        image: PYTHON_RUNTIME.bundlingImage,
        command: [
          'bash',
          '-c',
          `pip install -t /asset-output/python ${pipArgs}`,
        ],
        local: {
          tryBundle(outputDir: string): boolean {
            try {
              const pythonDir = path.join(outputDir, 'python');
              fs.mkdirSync(pythonDir, { recursive: true });
              execSync(`pip install -t "${pythonDir}" ${pipArgs}`, {
                stdio: 'inherit',
              });
              return true;
            } catch (e) {
              console.error(`Local bundling failed: ${e}`);
              return false;
            }
          },
        },
      },
    });
  }
}
