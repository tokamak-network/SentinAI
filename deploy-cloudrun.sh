#!/bin/bash
# SentinAI - Cloud Run Deployment Script

set -e

# Configuration
PROJECT_ID="your-gcp-project-id"  # TODO: Replace with your GCP project ID
SERVICE_NAME="sentinai"
REGION="asia-northeast3"  # Seoul region
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

echo "🛡️ SentinAI Cloud Run Deployment"
echo "=================================="
echo "Project: ${PROJECT_ID}"
echo "Service: ${SERVICE_NAME}"
echo "Region: ${REGION}"
echo ""

# Step 1: Build Docker image
echo "📦 Building Docker image..."
docker build -t ${IMAGE_NAME}:latest .

# Step 2: Push to Google Container Registry
echo "📤 Pushing image to GCR..."
docker push ${IMAGE_NAME}:latest

# Step 3: Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME}:latest \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10 \
  --set-env-vars "NODE_ENV=production" \
  --project ${PROJECT_ID}

echo ""
echo "✅ Deployment complete!"
echo "🌐 Service URL: https://${SERVICE_NAME}-<random>.a.run.app"
echo ""
echo "📝 Next steps:"
echo "1. Set environment variables: gcloud run services update ${SERVICE_NAME} --update-env-vars KEY=VALUE"
echo "2. View logs: gcloud run services logs read ${SERVICE_NAME} --region ${REGION}"
