# Base image with Node.js 18
FROM node:18-slim

# Install system dependencies for yt-dlp and ffmpeg
RUN apt-get update && apt-get install -y \
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

# Install dependencies
RUN pnpm install

# Build everything
RUN pnpm run build --if-present

# Set environment variables
ENV NODE_ENV=production
ENV PORT=5000

# Expose the dashboard port
EXPOSE 5000

# Start the bot using the workspace filter
CMD ["pnpm", "start"]
