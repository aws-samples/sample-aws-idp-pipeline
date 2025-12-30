import { ApplicationStack } from './stacks/application-stack.js';
import { AgentStack } from './stacks/agent-stack.js';
import { App } from ':idp-v2/common-constructs';
import { StorageStack } from './stacks/storage-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new StorageStack(app, 'IDP-V2-Storage', {
  env,
});

new ApplicationStack(app, 'IDP-V2-Application', {
  env,
  crossRegionReferences: true,
});

new AgentStack(app, 'IDP-V2-Agent', {
  env,
});

app.synth();
