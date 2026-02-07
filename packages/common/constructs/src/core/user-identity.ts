import {
  IdentityPool,
  UserPoolAuthenticationProvider,
} from 'aws-cdk-lib/aws-cognito-identitypool';
import { CfnOutput, Duration, Lazy, Stack } from 'aws-cdk-lib';
import {
  AccountRecovery,
  CfnManagedLoginBranding,
  CfnUserPoolDomain,
  FeaturePlan,
  Mfa,
  OAuthScope,
  UserPool,
  UserPoolClient,
  UserPoolOperation,
} from 'aws-cdk-lib/aws-cognito';
import { Construct } from 'constructs';
import { RuntimeConfig } from './runtime-config.js';
import { Distribution } from 'aws-cdk-lib/aws-cloudfront';
import { ITableV2 } from 'aws-cdk-lib/aws-dynamodb';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { fileURLToPath } from 'url';
import * as fs from 'fs';
import * as path from 'path';

const WEB_CLIENT_ID = 'WebClient';
/**
 * Creates a UserPool and Identity Pool with sane defaults configured intended for usage from a web client.
 */
export class UserIdentity extends Construct {
  public readonly region: string;
  public readonly identityPool: IdentityPool;
  public readonly userPool: UserPool;
  public readonly userPoolClient: UserPoolClient;
  public readonly userPoolDomain: CfnUserPoolDomain;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.region = Stack.of(this).region;
    this.userPool = this.createUserPool();
    this.userPoolDomain = this.createUserPoolDomain(this.userPool);
    this.userPoolClient = this.createUserPoolClient(this.userPool);
    this.identityPool = this.createIdentityPool(
      this.userPool,
      this.userPoolClient,
    );
    this.createManagedLoginBranding(
      this.userPool,
      this.userPoolClient,
      this.userPoolDomain,
    );

    RuntimeConfig.ensure(this).config.cognitoProps = {
      region: Stack.of(this).region,
      identityPoolId: this.identityPool.identityPoolId,
      userPoolId: this.userPool.userPoolId,
      userPoolWebClientId: this.userPoolClient.userPoolClientId,
    };

    new CfnOutput(this, `${id}-UserPoolId`, {
      value: this.userPool.userPoolId,
    });

    new CfnOutput(this, `${id}-UserPoolClientId`, {
      value: this.userPoolClient.userPoolClientId,
    });

    new CfnOutput(this, `${id}-IdentityPoolId`, {
      value: this.identityPool.identityPoolId,
    });
  }

  private createUserPool = () =>
    new UserPool(this, 'UserPool', {
      deletionProtection: true,
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(3),
      },
      mfa: Mfa.OFF,
      featurePlan: FeaturePlan.PLUS,
      signInCaseSensitive: false,
      signInAliases: { username: true, email: true },
      accountRecovery: AccountRecovery.EMAIL_ONLY,
      selfSignUpEnabled: false,
      standardAttributes: {
        email: { required: true },
        givenName: { required: true },
        familyName: { required: true },
      },
      autoVerify: {
        email: true,
      },
      keepOriginal: {
        email: true,
      },
    });

  private createUserPoolDomain = (userPool: UserPool) =>
    new CfnUserPoolDomain(this, 'UserPoolDomain', {
      domain: `idp-v2-${Stack.of(this).account}`,
      userPoolId: userPool.userPoolId,
      managedLoginVersion: 2,
    });

  private createUserPoolClient = (userPool: UserPool) => {
    const lazilyComputedCallbackUrls = Lazy.list({
      produce: () =>
        [
          'http://localhost:4200',
          'http://localhost:4300',
          `https://${Stack.of(this).region}.console.aws.amazon.com`,
        ].concat(
          this.findCloudFrontDistributions().map(
            (d) => `https://${d.domainName}`,
          ),
        ),
    });

    return userPool.addClient(WEB_CLIENT_ID, {
      authFlows: {
        userPassword: true,
        userSrp: true,
        user: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
        },
        scopes: [OAuthScope.EMAIL, OAuthScope.OPENID, OAuthScope.PROFILE],
        callbackUrls: lazilyComputedCallbackUrls,
        logoutUrls: lazilyComputedCallbackUrls,
      },
      preventUserExistenceErrors: true,
    });
  };

  private createIdentityPool = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
  ) => {
    const identityPool = new IdentityPool(this, 'IdentityPool');

    identityPool.addUserPoolAuthentication(
      new UserPoolAuthenticationProvider({
        userPool,
        userPoolClient,
      }),
    );

    return identityPool;
  };

  private createManagedLoginBranding = (
    userPool: UserPool,
    userPoolClient: UserPoolClient,
    userPoolDomain: CfnUserPoolDomain,
  ) => {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const assetsDir = path.join(__dirname, 'assets');

    const logoBytes = fs
      .readFileSync(path.join(assetsDir, 'logo.png'))
      .toString('base64');
    const bgBytes = fs
      .readFileSync(path.join(assetsDir, 'background.jpg'))
      .toString('base64');

    new CfnManagedLoginBranding(this, 'ManagedLoginBranding', {
      userPoolId: userPool.userPoolId,
      clientId: userPoolClient.userPoolClientId,
      useCognitoProvidedValues: false,
      assets: [
        {
          category: 'FORM_LOGO',
          colorMode: 'LIGHT',
          extension: 'PNG',
          bytes: logoBytes,
        },
        {
          category: 'FORM_LOGO',
          colorMode: 'DARK',
          extension: 'PNG',
          bytes: logoBytes,
        },
        {
          category: 'PAGE_BACKGROUND',
          colorMode: 'LIGHT',
          extension: 'JPEG',
          bytes: bgBytes,
        },
        {
          category: 'PAGE_BACKGROUND',
          colorMode: 'DARK',
          extension: 'JPEG',
          bytes: bgBytes,
        },
      ],
      settings: {
        components: {
          form: {
            borderRadius: 12,
            logo: {
              location: 'CENTER',
              position: 'TOP',
              enabled: true,
              formInclusion: 'IN',
            },
            lightMode: {
              backgroundColor: 'f8fafcff',
              borderColor: 'e2e8f0ff',
            },
            darkMode: {
              backgroundColor: 'f1f5f9ff',
              borderColor: 'cbd5e1ff',
            },
          },
          pageBackground: {
            image: { enabled: true },
            lightMode: { color: '0f172aff' },
            darkMode: { color: '0f172aff' },
          },
          primaryButton: {
            lightMode: {
              defaults: { backgroundColor: 'f59e0bff', textColor: '0f172aff' },
              hover: { backgroundColor: 'd97706ff', textColor: '0f172aff' },
              active: { backgroundColor: 'b45309ff', textColor: '0f172aff' },
            },
            darkMode: {
              defaults: { backgroundColor: 'f59e0bff', textColor: '0f172aff' },
              hover: { backgroundColor: 'd97706ff', textColor: '0f172aff' },
              active: { backgroundColor: 'b45309ff', textColor: '0f172aff' },
            },
          },
          secondaryButton: {
            lightMode: {
              defaults: {
                backgroundColor: 'ffffffff',
                borderColor: 'cbd5e1ff',
                textColor: '475569ff',
              },
              hover: {
                backgroundColor: 'f1f5f9ff',
                borderColor: '94a3b8ff',
                textColor: '334155ff',
              },
              active: {
                backgroundColor: 'e2e8f0ff',
                borderColor: '64748bff',
                textColor: '1e293bff',
              },
            },
            darkMode: {
              defaults: {
                backgroundColor: 'ffffffff',
                borderColor: 'cbd5e1ff',
                textColor: '475569ff',
              },
              hover: {
                backgroundColor: 'f1f5f9ff',
                borderColor: '94a3b8ff',
                textColor: '334155ff',
              },
              active: {
                backgroundColor: 'e2e8f0ff',
                borderColor: '64748bff',
                textColor: '1e293bff',
              },
            },
          },
          pageText: {
            lightMode: {
              headingColor: '0f172aff',
              bodyColor: '475569ff',
              descriptionColor: '64748bff',
            },
            darkMode: {
              headingColor: '0f172aff',
              bodyColor: '475569ff',
              descriptionColor: '64748bff',
            },
          },
        },
        componentClasses: {
          input: {
            borderRadius: 8,
            lightMode: {
              defaults: {
                backgroundColor: 'ffffffff',
                borderColor: 'cbd5e1ff',
              },
              placeholderColor: '94a3b8ff',
            },
            darkMode: {
              defaults: {
                backgroundColor: 'ffffffff',
                borderColor: 'cbd5e1ff',
              },
              placeholderColor: '94a3b8ff',
            },
          },
          inputLabel: {
            lightMode: { textColor: '334155ff' },
            darkMode: { textColor: '334155ff' },
          },
          link: {
            lightMode: {
              defaults: { textColor: '2563ebff' },
              hover: { textColor: '1d4ed8ff' },
            },
            darkMode: {
              defaults: { textColor: '2563ebff' },
              hover: { textColor: '1d4ed8ff' },
            },
          },
          focusState: {
            lightMode: { borderColor: 'f59e0bff' },
            darkMode: { borderColor: 'f59e0bff' },
          },
        },
        categories: {
          form: {
            displayGraphics: true,
            instructions: { enabled: false },
            languageSelector: { enabled: false },
            location: { horizontal: 'CENTER', vertical: 'CENTER' },
          },
          global: {
            colorSchemeMode: 'DARK',
            pageHeader: { enabled: false },
            pageFooter: { enabled: false },
            spacingDensity: 'REGULAR',
          },
          auth: {
            authMethodOrder: [
              [{ display: 'INPUT', type: 'USERNAME_PASSWORD' }],
            ],
          },
        },
      },
    }).node.addDependency(userPoolClient, userPool, userPoolDomain);
  };

  private findCloudFrontDistributions = (): Distribution[] =>
    Stack.of(this)
      .node.findAll()
      .filter((child) => child instanceof Distribution);

  public addPostAuthenticationTrigger(backendTable: ITableV2): NodejsFunction {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);

    const postAuthenticationFn = new NodejsFunction(
      this,
      'PostAuthenticationTrigger',
      {
        runtime: Runtime.NODEJS_22_X,
        entry: path.join(
          __dirname,
          '../../../../lambda/cognito-trigger/src/post-authentication.ts',
        ),
        handler: 'handler',
        environment: {
          TABLE_NAME: backendTable.tableName,
        },
      },
    );

    backendTable.grantWriteData(postAuthenticationFn);

    this.userPool.addTrigger(
      UserPoolOperation.POST_AUTHENTICATION,
      postAuthenticationFn,
    );

    return postAuthenticationFn;
  }
}
