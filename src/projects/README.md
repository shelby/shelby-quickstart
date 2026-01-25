# Shelby Projects

This directory contains four fully-built Shelby integration projects that demonstrate different use cases for decentralized blob storage.

## Quick Start

### Prerequisites
- Node.js v22 or later
- Shelby CLI installed and configured (`shelby account create`)
- Dependencies installed (`npm install`)

### Run a Project

```bash
npm run file-storage      # File versioning system
npm run nft-metadata      # NFT metadata storage
npm run backup            # Backup & archive tool
npm run content           # Content distribution platform
npm run portfolio         # Professional portfolio registry
npm run game              # Treasure hunt game
```

## Project Overview

### 1. **File Storage** (`npm run file-storage`)
A decentralized file management system with version control.

**Features:**
- Upload files to Shelby with automatic versioning
- Download specific versions of files
- List all stored files and their versions
- Merkle root verification for data integrity
- Local registry tracking (`.shelby-registry.json`)

**Use Cases:** Document management, versioned backups, cloud storage

---

### 2. **NFT Metadata Storage** (`npm run nft-metadata`)
Immutable metadata storage for NFT collections.

**Features:**
- Mint NFTs with structured metadata (name, attributes, image URL, etc.)
- Retrieve and verify NFT metadata
- Organize NFTs by collection
- Export collection metadata as JSON
- 10-year storage duration for permanence
- Local registry tracking (`.nft-registry.json`)

**Use Cases:** NFT collections, digital art, token metadata

---

### 3. **Backup & Archive Tool** (`npm run backup`)
Comprehensive backup and disaster recovery system.

**Features:**
- Create compressed backups of entire directories
- Automatic file discovery and archival
- Optional GZIP compression
- Restore backups to any location
- 30-year storage duration for archival
- Version tracking with timestamps
- Metadata about backup contents
- Local registry tracking (`.backup-registry.json`)

**Use Cases:** System backups, archival, disaster recovery, historical data preservation

---

### 4. **Content Distribution Platform** (`npm run content`)
Publish, discover, and share content globally.

**Features:**
- Publish content with metadata (title, author, category, description)
- Browse content by category
- Full-text search across all content
- Download tracking and popularity metrics
- View top downloaded content
- View detailed content information
- Configurable storage duration
- Local registry tracking (`.content-registry.json`)

**Use Cases:** Content libraries, knowledge bases, community platforms, media distribution

---

### 5. **Professional Portfolio Registry** (`npm run portfolio`)
Immutable resume and professional profile storage with verification.

**Features:**
- Create professional portfolios with skills, experience, and education
- Merkle root verification for authenticity
- Portfolio ownership verification with codes
- Search portfolios by name, skill, or company
- View formatted professional profiles
- Export portfolios as JSON
- Built-in portfolio directory/discovery
- Local registry tracking (`.portfolio-registry.json`)

**Use Cases:** Professional networking, recruitment, portfolio verification, credential management

---

### 6. **Treasure Hunt Game** (`npm run game`)
An interactive multiplayer treasure hunt game using Shelby for immutable game state.

**Features:**
- Create multi-clue treasure hunts with difficulty levels
- Play and solve treasures with hint system
- Leaderboard with solver rankings
- Statistics tracking and game analytics
- Merkle root verification for treasures
- Attempts and hints tracking
- Reward system
- Local progress tracking (`.treasure-hunt-registry.json`)

**Use Cases:** Gaming, education, team building, interactive puzzles, gamification

---

## Technical Details
Each project follows this pattern:
1. **Local Configuration**: Uses `.shelby/config.yaml` from Shelby CLI
2. **Interactive CLI**: Built with `@inquirer/prompts` for user interaction
3. **Local Registry**: JSON-based registry for tracking stored data
4. **Merkle Verification**: Hash-based integrity verification
5. **Demo Mode**: Currently simulates Shelby SDK calls (ready for real SDK integration)

### File Structure
```
src/projects/
├── file-storage.ts           # File versioning system
├── nft-metadata.ts           # NFT metadata storage
├── backup-archive.ts         # Backup & archive tool
├── content-distribution.ts   # Content distribution platform
├── portfolio-registry.ts     # Professional portfolio registry
└── treasure-hunt.ts          # Treasure hunt game
```

### Local Data
Each project creates a local registry file:
- `.shelby-registry.json` - File storage registry
- `.nft-registry.json` - NFT metadata registry
- `.backup-registry.json` - Backup registry
- `.content-registry.json` - Content distribution registry

---

## Configuration

All projects use the same configuration approach:
1. Reads from `~/.shelby/config.yaml` (Shelby CLI config)
2. Prompts for account selection (if multiple)
3. Prompts for context selection (Aptos network)
4. Optionally prompts for API key

**NOTE:** Make sure you've run `npm run config` first to set up your `.env` file and Shelby CLI configuration.

---

## Development

### Watch Mode
For active development with automatic recompilation:
```bash
npm run dev
```

### Build
To compile all TypeScript:
```bash
npm run build
```

### Type Checking
To verify TypeScript without building:
```bash
npm run type-check
```

---

## Next Steps

1. **Customize**: Modify any project to fit your use case
2. **Integrate**: Use the Shelby SDK methods in your own code
3. **Extend**: Add more features or combine projects
4. **Deploy**: Package and distribute your applications

---

## Support

For more information about Shelby:
- **Documentation**: https://docs.shelby.xyz
- **Whitepaper**: See `assets/whitepaper.pdf`
- **Discord**: https://discord.gg/shelby

---

## License

MIT - See LICENSE file for details
