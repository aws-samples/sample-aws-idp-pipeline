#!/bin/bash

echo ""
echo "==========================================================================="
echo "  Sample AWS IDP Pipeline - Automated Deployment"
echo "---------------------------------------------------------------------------"
echo "  Deploys the full IDP pipeline via CodeBuild."
echo ""
echo "  Stacks: Vpc, Storage, Event, Bda, Ocr, Transcribe, Workflow,"
echo "          Websocket, Worker, Mcp, Agent, Application"
echo "==========================================================================="
echo ""

# Default parameters
REPO_URL="https://github.com/aws-samples/sample-aws-idp-pipeline.git"
VERSION="main"
STACK_NAME="sample-aws-idp-pipeline-codebuild"
TEMPLATE_URL_BASE="https://raw.githubusercontent.com/aws-samples/sample-aws-idp-pipeline"
TEMPLATE_FILE="/tmp/deploy-codebuild.yml"
ADMIN_USER_EMAIL=""

# Parse command-line arguments
while [[ "$#" -gt 0 ]]; do
    case $1 in
        --admin-email) ADMIN_USER_EMAIL="$2"; shift ;;
        --repo-url) REPO_URL="$2"; shift ;;
        --version) VERSION="$2"; shift ;;
        --stack-name) STACK_NAME="$2"; shift ;;
        --help)
            echo "Usage: $0 [OPTIONS]"
            echo ""
            echo "Options:"
            echo "  --admin-email EMAIL   Admin user email for Cognito (required)"
            echo "  --repo-url URL        Repository URL (default: github.com/aws-samples/sample-aws-idp-pipeline)"
            echo "  --version VERSION     Branch or tag to deploy (default: main)"
            echo "  --stack-name NAME     CloudFormation stack name (default: sample-aws-idp-pipeline-codebuild)"
            echo "  --help                Show this help message"
            exit 0
            ;;
        *) echo "Unknown parameter: $1"; exit 1 ;;
    esac
    shift
done

# Prompt for email if not provided
if [[ -z "$ADMIN_USER_EMAIL" ]]; then
    while true; do
        read -p "Enter admin user email address: " ADMIN_USER_EMAIL
        if [[ "$ADMIN_USER_EMAIL" =~ ^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$ ]]; then
            break
        else
            echo "Invalid email format. Please enter a valid email address."
        fi
    done
fi

# Display configuration
echo ""
echo "Configuration:"
echo "--------------"
echo "Admin Email: $ADMIN_USER_EMAIL"
echo "Repository:  $REPO_URL"
echo "Version:     $VERSION"
echo "Stack Name:  $STACK_NAME"
echo ""

# Confirm deployment
while true; do
    read -p "Do you want to proceed with deployment? (y/N): " answer
    case ${answer:0:1} in
        y|Y ) break ;;
        n|N|"" ) echo "Deployment cancelled."; exit 0 ;;
        * ) echo "Please enter y or n." ;;
    esac
done

# Download CloudFormation template
TEMPLATE_URL="${TEMPLATE_URL_BASE}/${VERSION}/deploy-codebuild.yml"
echo ""
echo "Downloading CloudFormation template..."
echo "  $TEMPLATE_URL"
curl -fsSL -o "$TEMPLATE_FILE" "$TEMPLATE_URL"
if [[ $? -ne 0 ]]; then
    echo "Failed to download template from $TEMPLATE_URL"
    exit 1
fi

# Validate template
echo "Validating CloudFormation template..."
aws cloudformation validate-template --template-body "file://$TEMPLATE_FILE" > /dev/null 2>&1
if [[ $? -ne 0 ]]; then
    echo "Template validation failed."
    exit 1
fi

# Deploy CloudFormation stack
echo "Deploying CodeBuild stack..."
aws cloudformation deploy \
    --stack-name "$STACK_NAME" \
    --template-file "$TEMPLATE_FILE" \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides \
        AdminUserEmail="$ADMIN_USER_EMAIL" \
        RepoUrl="$REPO_URL" \
        Version="$VERSION"

if [[ $? -ne 0 ]]; then
    echo "CloudFormation deployment failed."
    exit 1
fi

echo "Waiting for stack to complete..."
spin='-\|/'
i=0
while true; do
    status=$(aws cloudformation describe-stacks --stack-name "$STACK_NAME" --query 'Stacks[0].StackStatus' --output text 2>/dev/null)
    if [[ "$status" == "CREATE_COMPLETE" || "$status" == "UPDATE_COMPLETE" ]]; then
        break
    elif [[ "$status" == *"FAILED"* || "$status" == *"ROLLBACK"* ]]; then
        echo ""
        echo "Stack failed with status: $status"
        exit 1
    fi
    printf "\r${spin:i++%${#spin}:1}"
    sleep 1
done
echo -e "\nStack deployed successfully."

# Get CodeBuild project name
PROJECT_NAME=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query 'Stacks[0].Outputs[?OutputKey==`ProjectName`].OutputValue' \
    --output text)

if [[ -z "$PROJECT_NAME" ]]; then
    echo "Failed to retrieve CodeBuild project name."
    exit 1
fi

# Start CodeBuild
echo ""
echo "Starting CodeBuild: $PROJECT_NAME ..."
BUILD_ID=$(aws codebuild start-build --project-name "$PROJECT_NAME" --query 'build.id' --output text)

if [[ -z "$BUILD_ID" ]]; then
    echo "Failed to start CodeBuild."
    exit 1
fi

echo "Build ID: $BUILD_ID"
echo ""
echo "You can monitor progress in the AWS Console:"
echo "  CodeBuild > Build projects > $PROJECT_NAME"
echo ""

# Wait for build
while true; do
    BUILD_STATUS=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].buildStatus' --output text)
    PHASE=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].phases[?phaseStatus==`IN_PROGRESS`].phaseType' --output text)

    if [[ -n "$PHASE" ]]; then
        echo -ne "\rPhase: $PHASE          "
    fi

    if [[ "$BUILD_STATUS" == "SUCCEEDED" || "$BUILD_STATUS" == "FAILED" || "$BUILD_STATUS" == "STOPPED" ]]; then
        echo ""
        break
    fi
    sleep 10
done

echo ""
echo "Build completed: $BUILD_STATUS"

if [[ "$BUILD_STATUS" != "SUCCEEDED" ]]; then
    BUILD_DETAIL=$(aws codebuild batch-get-builds --ids "$BUILD_ID" --query 'builds[0].logs.{groupName: groupName, streamName: streamName}' --output json)
    LOG_GROUP=$(echo "$BUILD_DETAIL" | jq -r '.groupName')

    echo ""
    echo "Build failed. For logs:"
    echo "  aws logs tail $LOG_GROUP --since 10m"
    exit 1
fi

# Get frontend URL
FRONTEND_DOMAIN=$(aws cloudformation describe-stacks --stack-name IDP-V2-Application \
    --query 'Stacks[0].Outputs[?contains(OutputKey,`DistributionDomainName`)].OutputValue' --output text 2>/dev/null)

echo ""
echo "==========================================================================="
echo "  Deployment Successful"
echo "==========================================================================="
echo ""
if [[ -n "$FRONTEND_DOMAIN" && "$FRONTEND_DOMAIN" != "None" ]]; then
echo "  Application URL: https://$FRONTEND_DOMAIN"
echo ""
fi
echo "  Login Credentials:"
echo "     Email:              $ADMIN_USER_EMAIL"
echo "     Temporary Password: TempPass123!"
echo ""
echo "  Next Steps:"
echo "     1. Access the application using the URL above"
echo "     2. Log in with the credentials"
echo "     3. Change your password when prompted"
echo ""
echo "  To destroy all resources:"
echo "     aws cloudformation delete-stack --stack-name $STACK_NAME"
echo ""
echo "==========================================================================="
