import { Construct } from 'constructs';
import * as url from 'url';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import {
  Code,
  Runtime,
  Function,
  FunctionProps,
  Tracing,
} from 'aws-cdk-lib/aws-lambda';
import { Duration } from 'aws-cdk-lib';
import { CorsHttpMethod, CfnApi } from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Grant, IGrantable } from 'aws-cdk-lib/aws-iam';
import {
  HttpApiIntegration,
  IntegrationBuilder,
} from '../../core/api/utils.js';
import { HttpApi } from '../../core/api/http-api.js';
import {
  OPERATION_DETAILS,
  Operations,
} from '../../generated/backend/metadata.gen.js';

/**
 * Properties for creating a Backend construct
 *
 * @template TIntegrations - Map of operation names to their integrations
 */
export interface BackendProps<
  TIntegrations extends Record<Operations, HttpApiIntegration>,
> {
  /**
   * Map of operation names to their API Gateway integrations
   */
  integrations: TIntegrations;
}

/**
 * A CDK construct that creates and configures an AWS API Gateway HTTP API
 * specifically for Backend.
 * @template TIntegrations - Map of operation names to their integrations
 */
export class Backend<
  TIntegrations extends Record<Operations, HttpApiIntegration>,
> extends HttpApi<Operations, TIntegrations> {
  /**
   * Creates default integrations for all operations, which implement each operation as
   * its own individual lambda function.
   *
   * @param scope - The CDK construct scope
   * @returns An IntegrationBuilder with default lambda integrations
   */
  public static defaultIntegrations = (scope: Construct) => {
    return IntegrationBuilder.http({
      operations: OPERATION_DETAILS,
      defaultIntegrationOptions: {
        runtime: Runtime.PYTHON_3_12,
        handler: 'idp_v2_backend.main.handler',
        code: Code.fromAsset(
          url.fileURLToPath(
            new URL(
              '../../../../../../dist/packages/backend/bundle-x86',
              import.meta.url,
            ),
          ),
        ),
        timeout: Duration.seconds(30),
        tracing: Tracing.ACTIVE,
        environment: {
          AWS_CONNECTION_REUSE_ENABLED: '1',
        },
      } satisfies FunctionProps,
      buildDefaultIntegration: (op, props: FunctionProps) => {
        const handler = new Function(scope, `Backend${op}Handler`, props);
        return {
          handler,
          integration: new HttpLambdaIntegration(
            `Backend${op}Integration`,
            handler,
          ),
        };
      },
    });
  };

  constructor(
    scope: Construct,
    id: string,
    props: BackendProps<TIntegrations>,
  ) {
    super(scope, id, {
      apiName: 'Backend',
      corsPreflight: {
        allowOrigins: ['*'],
        allowMethods: [CorsHttpMethod.ANY],
        allowHeaders: [
          'authorization',
          'content-type',
          'x-amz-content-sha256',
          'x-amz-date',
          'x-amz-security-token',
        ],
      },
      defaultAuthorizer: new HttpIamAuthorizer(),
      operations: OPERATION_DETAILS,
      ...props,
    });
  }

  /**
   * Restricts CORS to the website CloudFront distribution domains
   *
   * Configures the CloudFront distribution domains as the only permitted CORS origins
   * (other than local host with default ports) in the API gateway
   * The CORS origins are not configured within the AWS Lambda integrations since
   * the associated header is controlled by API Gateway v2
   *
   * @param cloudFrontDistribution - The CloudFront distribution to grant CORS from
   */
  public restrictCorsTo(
    ...websites: { cloudFrontDistribution: Distribution }[]
  ) {
    const allowedOrigins = websites.map(
      ({ cloudFrontDistribution }) =>
        `https://${cloudFrontDistribution.distributionDomainName}`,
    );

    const cfnApi = this.api.node.defaultChild;
    if (!(cfnApi instanceof CfnApi)) {
      throw new Error(
        'Unable to configure CORS: API default child is not a CfnApi instance',
      );
    }

    cfnApi.corsConfiguration = {
      allowOrigins: [
        'http://localhost:4200',
        'http://localhost:4300',
        ...allowedOrigins,
      ],
      allowMethods: [CorsHttpMethod.ANY],
      allowHeaders: [
        'authorization',
        'content-type',
        'x-amz-content-sha256',
        'x-amz-date',
        'x-amz-security-token',
      ],
    };
  }

  /**
   * Grants IAM permissions to invoke any method on this API.
   *
   * @param grantee - The IAM principal to grant permissions to
   */
  public grantInvokeAccess(grantee: IGrantable) {
    Grant.addToPrincipal({
      grantee,
      actions: ['execute-api:Invoke'],
      resourceArns: [this.api.arnForExecuteApi('*', '/*', '*')],
    });
  }
}
