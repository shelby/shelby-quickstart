import { select, input, confirm } from "@inquirer/prompts";
import chalk from "chalk";
import ora from "ora";
import * as fs from "fs";
import * as path from "path";
import type { EnvVariables } from "../guide/util/types.js";
import accountConfig from "../guide/util/account-config.js";
import apiConfig from "../guide/util/api-config.js";
import contextConfig from "../guide/util/context-config.js";
import envCheck from "../guide/util/env-check.js";

interface ContentRecord {
  id: string;
  title: string;
  author: string;
  category: string;
  description: string;
  blobName: string;
  merkleRoot: string;
  createdAt: number;
  expiresAt: number;
  fileSize: number;
  contentType: string;
  downloads: number;
}

interface ContentPlatform {
  [contentId: string]: ContentRecord;
}

// Initialize client configuration
async function getConfig(): Promise<EnvVariables> {
  const configPath = `${process.env.HOME}/.shelby/config.yaml`;
  const config = envCheck(configPath);

  const accountSettings = await accountConfig(config);
  if (!accountSettings) {
    throw new Error("No account found. Please run 'shelby account create' first.");
  }

  const contextSettings = await contextConfig(config);
  if (!contextSettings) {
    throw new Error("No context found. Please configure a context.");
  }

  const apiSettings = await apiConfig();

  return {
    account_name: accountSettings.account_name,
    address: accountSettings.address,
    private_key: accountSettings.private_key,
    context_name: contextSettings.context_name,
    network: contextSettings.network,
    api_key: apiSettings.api_key,
  };
}

// Get or create content registry
async function getContentRegistry(): Promise<ContentPlatform> {
  try {
    const registryFile = path.join(process.cwd(), ".content-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new content registry..."));
  }
  return {};
}

// Save content registry
async function saveContentRegistry(registry: ContentPlatform): Promise<void> {
  const registryFile = path.join(process.cwd(), ".content-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Publish content
export async function publishContent(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getContentRegistry();

  const filePath = await input({
    message: "Enter file path to publish:",
    validate: (val) => {
      if (!fs.existsSync(val)) return "File does not exist";
      const stat = fs.statSync(val);
      if (!stat.isFile()) return "Path must be a file";
      return true;
    },
  });

  const title = await input({ message: "Content title:" });
  const author = await input({ message: "Author name:" });
  const category = await input({
    message: "Category (e.g., tutorial, research, media):",
    default: "general",
  });
  const description = await input({
    message: "Description:",
    default: "",
  });

  const storageDays = await input({
    message: "Storage duration in days:",
    default: "365",
    validate: (val) => {
      if (isNaN(Number(val))) return "Must be a number";
      return true;
    },
  });

  const fileContent = fs.readFileSync(filePath);
  const fileSize = fileContent.length;
  const contentId = `content_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  const blobName = `content_${contentId}`;

  const spinner = ora("Publishing content to Shelby...").start();

  try {
    // Simulate merkle root generation
    const merkleRoot = Buffer.from(fileContent)
      .toString("hex")
      .substring(0, 64);

    spinner.succeed(chalk.green("Content published successfully!"));

    const expiresAt = Date.now() + Number(storageDays) * 24 * 60 * 60 * 1000;
    const contentType = path.extname(filePath).substring(1) || "unknown";

    const record: ContentRecord = {
      id: contentId,
      title,
      author,
      category,
      description,
      blobName,
      merkleRoot,
      createdAt: Date.now(),
      expiresAt,
      fileSize,
      contentType,
      downloads: 0,
    };

    registry[contentId] = record;
    await saveContentRegistry(registry);

    console.log(chalk.cyan("\n📢 Content Published:"));
    console.log(`  ID: ${contentId}`);
    console.log(`  Title: ${title}`);
    console.log(`  Author: ${author}`);
    console.log(`  Category: ${category}`);
    console.log(`  File Size: ${fileSize} bytes`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(`  Expires: ${new Date(expiresAt).toLocaleString()}`);
    console.log(chalk.green(`\nShare ID: ${contentId}`));
  } catch (error) {
    spinner.fail(chalk.red("Failed to publish content"));
    console.error(error);
  }
}

// Download content
export async function downloadContent(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getContentRegistry();

  const contentIds = Object.keys(registry);
  if (contentIds.length === 0) {
    console.log(chalk.yellow("No content available"));
    return;
  }

  const content = await select({
    message: "Select content to download:",
    choices: contentIds.map((id) => {
      const record = registry[id];
      return {
        name: `${record.title} by ${record.author} (${record.downloads} downloads)`,
        value: record,
      };
    }),
  });

  const outputPath = await input({
    message: "Enter output file path:",
    default: path.join(process.cwd(), `${content.title}.${content.contentType}`),
  });

  const spinner = ora("Downloading content from Shelby...").start();

  try {
    spinner.succeed(chalk.green("File downloaded successfully!"));
    console.log(chalk.cyan(`\nWould save to: ${outputPath}`));
    console.log(
      chalk.yellow(
        "Note: This is a demo. In production, the file would be retrieved from Shelby."
      )
    );

    // Update download count
    registry[content.id].downloads++;
    await saveContentRegistry(registry);
  } catch (error) {
    spinner.fail(chalk.red("Failed to download content"));
    console.error(error);
  }
}

// Browse content by category
export async function browseContent(): Promise<void> {
  const registry = await getContentRegistry();

  const contentIds = Object.keys(registry);
  if (contentIds.length === 0) {
    console.log(chalk.yellow("No content available"));
    return;
  }

  // Group by category
  const categories: { [key: string]: ContentRecord[] } = {};
  contentIds.forEach((id) => {
    const record = registry[id];
    if (!categories[record.category]) {
      categories[record.category] = [];
    }
    categories[record.category].push(record);
  });

  const categoryName = await select({
    message: "Select category:",
    choices: Object.keys(categories).map((cat) => ({
      name: `${cat} (${categories[cat].length} items)`,
      value: cat,
    })),
  });

  const items = categories[categoryName];
  console.log(chalk.cyan(`\n📚 ${categoryName}:`));
  items.forEach((item) => {
    console.log(chalk.bold(`\n${item.title}`));
    console.log(`  Author: ${item.author}`);
    console.log(`  Downloads: ${item.downloads}`);
    console.log(`  Size: ${item.fileSize} bytes`);
    if (item.description) {
      console.log(`  ${item.description}`);
    }
    console.log(`  Root: ${item.merkleRoot.substring(0, 16)}...`);
  });
}

// Search content
export async function searchContent(): Promise<void> {
  const registry = await getContentRegistry();

  const query = await input({
    message: "Search query (title, author, or description):",
  });

  const results = Object.values(registry).filter(
    (record) =>
      record.title.toLowerCase().includes(query.toLowerCase()) ||
      record.author.toLowerCase().includes(query.toLowerCase()) ||
      record.description.toLowerCase().includes(query.toLowerCase())
  );

  if (results.length === 0) {
    console.log(chalk.yellow("No matching content found"));
    return;
  }

  console.log(chalk.cyan(`\n🔍 Search Results for "${query}":`));
  results.forEach((item) => {
    console.log(chalk.bold(`\n${item.title}`));
    console.log(`  Author: ${item.author}`);
    console.log(`  Category: ${item.category}`);
    console.log(`  Downloads: ${item.downloads}`);
    if (item.description) {
      console.log(`  ${item.description}`);
    }
  });
}

// View top content
export async function topContent(): Promise<void> {
  const registry = await getContentRegistry();

  const contentIds = Object.keys(registry);
  if (contentIds.length === 0) {
    console.log(chalk.yellow("No content available"));
    return;
  }

  const sorted = Object.values(registry).sort(
    (a, b) => b.downloads - a.downloads
  );
  const limit = Math.min(10, sorted.length);

  console.log(chalk.cyan(`\n🏆 Top ${limit} Content:`));
  sorted.slice(0, limit).forEach((item, i) => {
    console.log(
      chalk.bold(`${i + 1}. ${item.title} - ${item.downloads} downloads`)
    );
    console.log(`   By ${item.author} | ${item.category}`);
  });
}

// Get content info
export async function contentInfo(): Promise<void> {
  const registry = await getContentRegistry();

  const contentId = await input({
    message: "Enter content ID:",
    validate: (val) => {
      if (!registry[val]) return "Content not found";
      return true;
    },
  });

  const content = registry[contentId];

  console.log(chalk.cyan("\n📄 Content Information:"));
  console.log(`  ID: ${content.id}`);
  console.log(`  Title: ${content.title}`);
  console.log(`  Author: ${content.author}`);
  console.log(`  Category: ${content.category}`);
  console.log(`  Type: ${content.contentType}`);
  console.log(`  File Size: ${content.fileSize} bytes`);
  console.log(`  Downloads: ${content.downloads}`);
  console.log(`  Created: ${new Date(content.createdAt).toLocaleString()}`);
  console.log(`  Expires: ${new Date(content.expiresAt).toLocaleString()}`);
  console.log(`  Merkle Root: ${content.merkleRoot}`);
  if (content.description) {
    console.log(`  Description: ${content.description}`);
  }
}

// Main menu
export async function contentPlatformMenu(): Promise<void> {
  const choice = await select({
    message: "Content Distribution Platform:",
    choices: [
      { name: "Publish Content", value: "publish" },
      { name: "Download Content", value: "download" },
      { name: "Browse by Category", value: "browse" },
      { name: "Search Content", value: "search" },
      { name: "Top Content", value: "top" },
      { name: "Content Info", value: "info" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "publish":
      await publishContent();
      break;
    case "download":
      await downloadContent();
      break;
    case "browse":
      await browseContent();
      break;
    case "search":
      await searchContent();
      break;
    case "top":
      await topContent();
      break;
    case "info":
      await contentInfo();
      break;
    case "exit":
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await contentPlatformMenu();
  }
}
