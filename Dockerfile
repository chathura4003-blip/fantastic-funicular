# Base image with Node.js 20 for stable crypto support
FROM node:20-slim

# Install system dependencies for yt-dlp and ffmpeg
RUN apt-get update && apt-get install -y \
    git \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Install pnpm globally
RUN npm install -g pnpm

# Set working directory
WORKDIR /app

# Copy the entire application First
COPY . .

# Install dependencies only for the bot to save memory
RUN pnpm install --filter supreme-md-bot... --reporter=append-only

# Skip explicit build step as supreme-md-bot doesn't need to be built

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the dashboard port
EXPOSE 5000

# Start the bot using the workspace filter
CMD ["pnpm", "start"]
