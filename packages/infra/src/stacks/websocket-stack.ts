import { Stack, StackProps } from 'aws-cdk-lib';
import { WebSocketApi, WebSocketStage } from 'aws-cdk-lib/aws-apigatewayv2';
import { WebSocketIamAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { WebSocketLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import { Vpc } from 'aws-cdk-lib/aws-ec2';
import { StringParameter } from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { SSM_KEYS, WebsocketFunctions } from ':idp-v2/common-constructs';

export class WebsocketStack extends Stack {
  public readonly api: WebSocketApi;
  public readonly stage: WebSocketStage;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const vpcId = StringParameter.valueFromLookup(this, SSM_KEYS.VPC_ID);
    const vpc = Vpc.fromLookup(this, 'Vpc', { vpcId });

    const elasticacheEndpoint = StringParameter.valueForStringParameter(
      this,
      SSM_KEYS.ELASTICACHE_ENDPOINT,
    );

    const functions = new WebsocketFunctions(this, 'WebsocketFunctions', {
      vpc,
      elasticacheEndpoint,
    });

    const iamAuthorizer = new WebSocketIamAuthorizer();

    this.api = new WebSocketApi(this, 'WebSocketApi', {
      apiName: 'idp-websocket-api',
      connectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          'ConnectIntegration',
          functions.connectFunction,
        ),
        authorizer: iamAuthorizer,
      },
      disconnectRouteOptions: {
        integration: new WebSocketLambdaIntegration(
          'DisconnectIntegration',
          functions.disconnectFunction,
        ),
      },
    });

    this.stage = new WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.api,
      stageName: 'prod',
      autoDeploy: true,
    });

    new StringParameter(this, 'WebSocketApiIdParam', {
      parameterName: SSM_KEYS.WEBSOCKET_API_ID,
      stringValue: this.api.apiId,
    });

    new StringParameter(this, 'WebSocketCallbackUrlParam', {
      parameterName: SSM_KEYS.WEBSOCKET_CALLBACK_URL,
      stringValue: this.stage.callbackUrl,
    });
  }
}
