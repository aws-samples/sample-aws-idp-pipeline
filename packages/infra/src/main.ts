import { ApplicationStack } from './stacks/application-stack.js';
import { AgentStack } from './stacks/agent-stack.js';
import { McpStack } from './stacks/mcp-stack.js';
import { App } from ':idp-v2/common-constructs';
import { StorageStack } from './stacks/storage-stack.js';
import { WorkflowStack } from './stacks/workflow-stack.js';
import { VpcStack } from './stacks/vpc-stack.js';

const app = new App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

new VpcStack(app, 'IDP-V2-Vpc', {
  env,
});

new StorageStack(app, 'IDP-V2-Storage', {
  env,
});

new WorkflowStack(app, 'IDP-V2-Workflow', {
  env,
});

const mcpStack = new McpStack(app, 'IDP-V2-Mcp', {
  env,
});

new AgentStack(app, 'IDP-V2-Agent', {
  env,
  gateway: mcpStack.gateway,
});

new ApplicationStack(app, 'IDP-V2-Application', {
  env,
  crossRegionReferences: true,
});

app.synth();
