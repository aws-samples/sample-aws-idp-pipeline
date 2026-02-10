import type { DynamoDBStreamHandler, DynamoDBRecord } from 'aws-lambda';
import { getConnectionIdsByProject } from './valkey.js';
import { sendToConnection, WorkflowMessage, StepMessage } from './websocket.js';

interface WorkflowData {
  status?: { S: string };
  project_id?: { S: string };
  file_name?: { S: string };
}

interface StepData {
  project_id?: { S: string };
  document_id?: { S: string };
  current_step?: { S: string };
  [key: string]: { M?: { status?: { S: string } } } | { S: string } | undefined;
}

interface StreamImage {
  PK?: { S: string };
  SK?: { S: string };
  data?: { M: WorkflowData | StepData };
}

type RecordType = 'workflow' | 'step' | 'unknown';

function getRecordType(image: StreamImage | undefined): RecordType {
  if (!image) return 'unknown';

  const pk = image.PK?.S || '';
  const sk = image.SK?.S || '';

  if ((pk.startsWith('DOC#') || pk.startsWith('WEB#')) && sk.startsWith('WF#')) {
    return 'workflow';
  }
  if (pk.startsWith('WF#') && sk === 'STEP') {
    return 'step';
  }
  return 'unknown';
}

function extractWorkflowInfo(image: StreamImage | undefined) {
  if (!image) return null;

  const pk = image.PK?.S || '';
  const sk = image.SK?.S || '';
  const data = image.data?.M as WorkflowData | undefined;

  // Extract documentId from DOC# or WEB# prefix
  let documentId = '';
  if (pk.startsWith('DOC#')) {
    documentId = pk.slice(4);
  } else if (pk.startsWith('WEB#')) {
    documentId = pk.slice(4);
  }

  const workflowId = sk.startsWith('WF#') ? sk.slice(3) : '';
  const projectId = data?.project_id?.S || '';
  const status = data?.status?.S || '';

  return { documentId, workflowId, projectId, status };
}

function extractStepInfo(image: StreamImage | undefined) {
  if (!image) return null;

  const pk = image.PK?.S || '';
  const data = image.data?.M as StepData | undefined;

  const workflowId = pk.startsWith('WF#') ? pk.slice(3) : '';
  const projectId = data?.project_id?.S || '';
  const documentId = data?.document_id?.S || '';
  const currentStep = data?.current_step?.S || '';

  // Extract step statuses
  const steps: Record<string, string> = {};
  if (data) {
    for (const [key, value] of Object.entries(data)) {
      if (
        key !== 'project_id' &&
        key !== 'document_id' &&
        key !== 'current_step' &&
        value &&
        typeof value === 'object' &&
        'M' in value
      ) {
        const stepData = value.M as { status?: { S: string } } | undefined;
        if (stepData?.status?.S) {
          steps[key] = stepData.status.S;
        }
      }
    }
  }

  return { workflowId, projectId, documentId, currentStep, steps };
}

function findChangedSteps(
  oldSteps: Record<string, string>,
  newSteps: Record<string, string>,
): Array<{ stepName: string; oldStatus: string; newStatus: string }> {
  const changes: Array<{ stepName: string; oldStatus: string; newStatus: string }> = [];

  for (const [stepName, newStatus] of Object.entries(newSteps)) {
    const oldStatus = oldSteps[stepName] || '';
    if (oldStatus !== newStatus) {
      changes.push({ stepName, oldStatus, newStatus });
    }
  }

  return changes;
}

async function processWorkflowRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== 'MODIFY') {
    return;
  }

  const oldImage = record.dynamodb?.OldImage as StreamImage | undefined;
  const newImage = record.dynamodb?.NewImage as StreamImage | undefined;

  const oldInfo = extractWorkflowInfo(oldImage);
  const newInfo = extractWorkflowInfo(newImage);

  if (!oldInfo || !newInfo) {
    return;
  }

  if (oldInfo.status === newInfo.status) {
    return;
  }

  console.log(
    `Workflow ${newInfo.workflowId} status changed: ${oldInfo.status} -> ${newInfo.status}`,
  );

  const connectionIds = await getConnectionIdsByProject(newInfo.projectId);
  if (connectionIds.length === 0) {
    console.log(`No connections subscribed to project ${newInfo.projectId}, skipping`);
    return;
  }

  const message: WorkflowMessage = {
    action: 'workflow',
    data: {
      event: 'status_changed',
      workflowId: newInfo.workflowId,
      documentId: newInfo.documentId,
      projectId: newInfo.projectId,
      status: newInfo.status,
      previousStatus: oldInfo.status,
      timestamp: new Date().toISOString(),
    },
  };

  const messageStr = JSON.stringify(message);
  console.log(`Sending workflow message to ${connectionIds.length} connections`);

  await Promise.all(
    connectionIds.map((connectionId) =>
      sendToConnection(connectionId, messageStr, newInfo.projectId),
    ),
  );
}

async function processStepRecord(record: DynamoDBRecord): Promise<void> {
  if (record.eventName !== 'MODIFY') {
    return;
  }

  const oldImage = record.dynamodb?.OldImage as StreamImage | undefined;
  const newImage = record.dynamodb?.NewImage as StreamImage | undefined;

  const oldInfo = extractStepInfo(oldImage);
  const newInfo = extractStepInfo(newImage);

  if (!oldInfo || !newInfo) {
    return;
  }

  const changedSteps = findChangedSteps(oldInfo.steps, newInfo.steps);
  if (changedSteps.length === 0) {
    return;
  }

  console.log(
    `Workflow ${newInfo.workflowId} steps changed:`,
    changedSteps.map((c) => `${c.stepName}: ${c.oldStatus} -> ${c.newStatus}`).join(', '),
  );

  const connectionIds = await getConnectionIdsByProject(newInfo.projectId);
  if (connectionIds.length === 0) {
    console.log(`No connections subscribed to project ${newInfo.projectId}, skipping`);
    return;
  }

  // Send a message for each changed step
  for (const change of changedSteps) {
    const message: StepMessage = {
      action: 'step',
      data: {
        event: 'step_changed',
        workflowId: newInfo.workflowId,
        documentId: newInfo.documentId,
        projectId: newInfo.projectId,
        stepName: change.stepName,
        status: change.newStatus,
        previousStatus: change.oldStatus,
        currentStep: newInfo.currentStep,
        timestamp: new Date().toISOString(),
      },
    };

    const messageStr = JSON.stringify(message);
    console.log(`Sending step message: ${change.stepName} -> ${change.newStatus}`);

    await Promise.all(
      connectionIds.map((connectionId) =>
        sendToConnection(connectionId, messageStr, newInfo.projectId),
      ),
    );
  }
}

async function processRecord(record: DynamoDBRecord): Promise<void> {
  const newImage = record.dynamodb?.NewImage as StreamImage | undefined;
  const recordType = getRecordType(newImage);

  switch (recordType) {
    case 'workflow':
      await processWorkflowRecord(record);
      break;
    case 'step':
      await processStepRecord(record);
      break;
    default:
      console.log('Unknown record type, skipping');
  }
}

export const handler: DynamoDBStreamHandler = async (event) => {
  console.log(`Processing ${event.Records.length} records`);

  for (const record of event.Records) {
    try {
      await processRecord(record);
    } catch (error) {
      console.error('Error processing record:', error);
    }
  }
};
