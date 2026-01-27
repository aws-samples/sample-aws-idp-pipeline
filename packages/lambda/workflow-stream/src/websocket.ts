import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
  GoneException,
} from '@aws-sdk/client-apigatewaymanagementapi';

export interface WorkflowMessage {
  action: 'workflow';
  data: {
    event: 'status_changed';
    workflowId: string;
    documentId: string;
    projectId: string;
    status: string;
    previousStatus?: string;
    timestamp: string;
  };
}

export interface StepMessage {
  action: 'step';
  data: {
    event: 'step_changed';
    workflowId: string;
    projectId: string;
    stepName: string;
    status: string;
    previousStatus?: string;
    currentStep?: string;
    timestamp: string;
  };
}

const client = new ApiGatewayManagementApiClient({
  endpoint: process.env.WEBSOCKET_CALLBACK_URL,
});

export async function sendToConnection(
  connectionId: string,
  data: string,
): Promise<boolean> {
  try {
    await client.send(
      new PostToConnectionCommand({
        ConnectionId: connectionId,
        Data: data,
      }),
    );
    return true;
  } catch (error) {
    if (error instanceof GoneException) {
      console.log(`Connection ${connectionId} is gone, skipping`);
      return false;
    }
    throw error;
  }
}
