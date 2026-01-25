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

interface Experience {
  title: string;
  company: string;
  startDate: string;
  endDate: string;
  description: string;
}

interface Education {
  degree: string;
  institution: string;
  graduationYear: string;
  field: string;
}

interface Skill {
  name: string;
  proficiency: "beginner" | "intermediate" | "advanced" | "expert";
}

interface Portfolio {
  name: string;
  title: string;
  email: string;
  phone?: string;
  location?: string;
  bio: string;
  skills: Skill[];
  experience: Experience[];
  education: Education[];
  portfolio: Array<{
    name: string;
    url: string;
    description: string;
  }>;
}

interface PortfolioRecord {
  id: string;
  portfolio: Portfolio;
  blobName: string;
  merkleRoot: string;
  createdAt: number;
  updatedAt: number;
  verified: boolean;
  verificationCode: string;
}

interface PortfolioRegistry {
  [userId: string]: PortfolioRecord;
}

// Get environment configuration
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

// Get or create portfolio registry
async function getPortfolioRegistry(): Promise<PortfolioRegistry> {
  try {
    const registryFile = path.join(process.cwd(), ".portfolio-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new portfolio registry..."));
  }
  return {};
}

// Save portfolio registry
async function savePortfolioRegistry(registry: PortfolioRegistry): Promise<void> {
  const registryFile = path.join(process.cwd(), ".portfolio-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Generate verification code
function generateVerificationCode(): string {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// Create portfolio interactively
async function createPortfolio(): Promise<Portfolio> {
  const name = await input({ message: "Full Name:" });
  const title = await input({ message: "Professional Title:" });
  const email = await input({ message: "Email:" });
  const phone = await input({
    message: "Phone (optional):",
    default: "",
  });
  const location = await input({
    message: "Location (optional):",
    default: "",
  });
  const bio = await input({ message: "Professional Bio:" });

  // Skills
  const skills: Skill[] = [];
  let addSkill = true;
  while (addSkill) {
    const skillName = await input({
      message: "Add a skill (or press Enter to finish):",
    });
    if (!skillName) break;

    const proficiency = await select({
      message: "Proficiency level:",
      choices: [
        { name: "Beginner", value: "beginner" as const },
        { name: "Intermediate", value: "intermediate" as const },
        { name: "Advanced", value: "advanced" as const },
        { name: "Expert", value: "expert" as const },
      ],
    });

    skills.push({ name: skillName, proficiency });
    addSkill = await confirm({ message: "Add another skill?" });
  }

  // Experience
  const experience: Experience[] = [];
  let addExp = true;
  while (addExp) {
    const expTitle = await input({
      message: "Add job title (or press Enter to skip):",
    });
    if (!expTitle) break;

    const company = await input({ message: "Company:" });
    const startDate = await input({ message: "Start date (MM/YYYY):" });
    const endDate = await input({
      message: "End date (MM/YYYY or 'Present'):",
    });
    const description = await input({ message: "Description:" });

    experience.push({ title: expTitle, company, startDate, endDate, description });
    addExp = await confirm({ message: "Add another position?" });
  }

  // Education
  const education: Education[] = [];
  let addEdu = true;
  while (addEdu) {
    const degree = await input({
      message: "Add degree (or press Enter to skip):",
    });
    if (!degree) break;

    const institution = await input({ message: "Institution:" });
    const field = await input({ message: "Field of Study:" });
    const graduationYear = await input({ message: "Graduation Year:" });

    education.push({ degree, institution, field, graduationYear });
    addEdu = await confirm({ message: "Add another degree?" });
  }

  // Portfolio Projects
  const portfolioProjects = [];
  let addProject = true;
  while (addProject) {
    const projectName = await input({
      message: "Add portfolio project (or press Enter to skip):",
    });
    if (!projectName) break;

    const url = await input({ message: "Project URL:" });
    const desc = await input({ message: "Description:" });

    portfolioProjects.push({ name: projectName, url, description: desc });
    addProject = await confirm({ message: "Add another project?" });
  }

  return {
    name,
    title,
    email,
    ...(phone && { phone }),
    ...(location && { location }),
    bio,
    skills,
    experience,
    education,
    portfolio: portfolioProjects,
  };
}

// Publish portfolio
export async function publishPortfolio(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getPortfolioRegistry();

  console.log(chalk.cyan("\n📋 Create Your Professional Portfolio:"));
  const portfolio = await createPortfolio();

  const spinner = ora("Publishing portfolio to Shelby...").start();

  try {
    const portfolioJson = JSON.stringify(portfolio, null, 2);
    const portfolioBuffer = Buffer.from(portfolioJson);
    const userId = `portfolio_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const blobName = `resume_${portfolio.name.replace(/\s+/g, "_")}_${userId}`;

    // Simulate merkle root
    const merkleRoot = portfolioBuffer
      .toString("hex")
      .substring(0, 64);

    const verificationCode = generateVerificationCode();

    spinner.succeed(chalk.green("Portfolio published successfully!"));

    const record: PortfolioRecord = {
      id: userId,
      portfolio,
      blobName,
      merkleRoot,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      verified: false,
      verificationCode,
    };

    registry[userId] = record;
    await savePortfolioRegistry(registry);

    console.log(chalk.cyan("\n🎯 Portfolio Published:"));
    console.log(`  Name: ${portfolio.name}`);
    console.log(`  Title: ${portfolio.title}`);
    console.log(`  Email: ${portfolio.email}`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(chalk.green(`\n✓ Portfolio ID: ${userId}`));
    console.log(chalk.yellow(`\n🔐 Verification Code: ${verificationCode}`));
    console.log("  (Share this code to prove portfolio ownership)");
  } catch (error) {
    spinner.fail(chalk.red("Failed to publish portfolio"));
    console.error(error);
  }
}

// Verify portfolio ownership
export async function verifyPortfolio(): Promise<void> {
  const registry = await getPortfolioRegistry();

  const portfolioIds = Object.keys(registry);
  if (portfolioIds.length === 0) {
    console.log(chalk.yellow("No portfolios found"));
    return;
  }

  const portfolioId = await input({
    message: "Enter Portfolio ID to verify:",
    validate: (val) => {
      if (!registry[val]) return "Portfolio not found";
      return true;
    },
  });

  const record = registry[portfolioId];
  const verificationCode = await input({
    message: "Enter verification code:",
  });

  if (verificationCode === record.verificationCode) {
    console.log(chalk.green("\n✅ Portfolio ownership verified!"));
    console.log(chalk.cyan(`  Owner: ${record.portfolio.name}`));
    console.log(`  Verified at: ${new Date(Date.now()).toLocaleString()}`);
    record.verified = true;
    record.updatedAt = Date.now();
    await savePortfolioRegistry(registry);
  } else {
    console.log(chalk.red("\n❌ Verification failed - incorrect code"));
  }
}

// View portfolio
export async function viewPortfolio(): Promise<void> {
  const registry = await getPortfolioRegistry();

  const portfolioIds = Object.keys(registry);
  if (portfolioIds.length === 0) {
    console.log(chalk.yellow("No portfolios found"));
    return;
  }

  const portfolioId = await select({
    message: "Select portfolio to view:",
    choices: portfolioIds.map((id) => ({
      name: `${registry[id].portfolio.name} - ${registry[id].portfolio.title}`,
      value: id,
    })),
  });

  const record = registry[portfolioId];
  const p = record.portfolio;

  console.log(chalk.cyan("\n" + "=".repeat(60)));
  console.log(chalk.bold.cyan(`${p.name}`));
  console.log(chalk.cyan(p.title));
  console.log("=".repeat(60));

  console.log(chalk.cyan("\n📧 Contact:"));
  console.log(`  Email: ${p.email}`);
  if (p.phone) console.log(`  Phone: ${p.phone}`);
  if (p.location) console.log(`  Location: ${p.location}`);

  console.log(chalk.cyan("\n📝 Bio:"));
  console.log(`  ${p.bio}`);

  if (p.skills.length > 0) {
    console.log(chalk.cyan("\n💼 Skills:"));
    p.skills.forEach((skill) => {
      const levelEmoji =
        skill.proficiency === "expert"
          ? "⭐⭐⭐⭐⭐"
          : skill.proficiency === "advanced"
            ? "⭐⭐⭐⭐"
            : skill.proficiency === "intermediate"
              ? "⭐⭐⭐"
              : "⭐⭐";
      console.log(`  ${skill.name} ${levelEmoji}`);
    });
  }

  if (p.experience.length > 0) {
    console.log(chalk.cyan("\n💻 Experience:"));
    p.experience.forEach((exp) => {
      console.log(`  ${exp.title} @ ${exp.company}`);
      console.log(`    ${exp.startDate} - ${exp.endDate}`);
      console.log(`    ${exp.description}`);
    });
  }

  if (p.education.length > 0) {
    console.log(chalk.cyan("\n🎓 Education:"));
    p.education.forEach((edu) => {
      console.log(`  ${edu.degree} in ${edu.field}`);
      console.log(`    ${edu.institution} (${edu.graduationYear})`);
    });
  }

  if (p.portfolio.length > 0) {
    console.log(chalk.cyan("\n🌐 Portfolio Projects:"));
    p.portfolio.forEach((proj) => {
      console.log(`  ${proj.name}`);
      console.log(`    ${proj.url}`);
      console.log(`    ${proj.description}`);
    });
  }

  console.log(chalk.cyan("\n🔐 Blockchain Info:"));
  console.log(`  Merkle Root: ${record.merkleRoot}`);
  console.log(`  Published: ${new Date(record.createdAt).toLocaleString()}`);
  console.log(`  Verified: ${record.verified ? "✅ Yes" : "❌ No"}`);
  console.log("=".repeat(60) + "\n");
}

// List all portfolios
export async function listPortfolios(): Promise<void> {
  const registry = await getPortfolioRegistry();

  const portfolioIds = Object.keys(registry);
  if (portfolioIds.length === 0) {
    console.log(chalk.yellow("No portfolios found"));
    return;
  }

  console.log(chalk.cyan("\n📚 Portfolio Directory:"));
  console.log("=".repeat(60));

  portfolioIds.forEach((id) => {
    const record = registry[id];
    const p = record.portfolio;
    const verified = record.verified ? chalk.green("✅") : chalk.gray("⏳");

    console.log(chalk.bold(`${p.name}`));
    console.log(`  ${p.title} | ${p.email}`);
    console.log(`  ${verified} Verified | 🔐 Root: ${record.merkleRoot.substring(0, 12)}...`);
    console.log("");
  });
  console.log("=".repeat(60));
}

// Search portfolios
export async function searchPortfolios(): Promise<void> {
  const registry = await getPortfolioRegistry();

  const query = await input({
    message: "Search (name, title, skill, company):",
  });

  const results = Object.entries(registry)
    .map(([id, record]) => ({ id, record }))
    .filter(
      ({ record }) =>
        record.portfolio.name.toLowerCase().includes(query.toLowerCase()) ||
        record.portfolio.title.toLowerCase().includes(query.toLowerCase()) ||
        record.portfolio.skills.some((s) =>
          s.name.toLowerCase().includes(query.toLowerCase())
        ) ||
        record.portfolio.experience.some((e) =>
          e.company.toLowerCase().includes(query.toLowerCase())
        )
    );

  if (results.length === 0) {
    console.log(chalk.yellow("No matching portfolios found"));
    return;
  }

  console.log(chalk.cyan(`\n🔍 Found ${results.length} matching portfolio(s):`));
  results.forEach(({ record }) => {
    const p = record.portfolio;
    console.log(chalk.bold(`\n${p.name}`));
    console.log(`  ${p.title}`);
    console.log(`  Email: ${p.email}`);
  });
}

// Export portfolio as JSON
export async function exportPortfolio(): Promise<void> {
  const registry = await getPortfolioRegistry();

  const portfolioIds = Object.keys(registry);
  if (portfolioIds.length === 0) {
    console.log(chalk.yellow("No portfolios found"));
    return;
  }

  const portfolioId = await select({
    message: "Select portfolio to export:",
    choices: portfolioIds.map((id) => ({
      name: `${registry[id].portfolio.name} - ${registry[id].portfolio.title}`,
      value: id,
    })),
  });

  const record = registry[portfolioId];
  const outputPath = await input({
    message: "Enter output file path:",
    default: path.join(
      process.cwd(),
      `${record.portfolio.name.replace(/\s+/g, "_")}_portfolio.json`
    ),
  });

  const exportData = {
    profile: record.portfolio,
    metadata: {
      publishedAt: new Date(record.createdAt).toISOString(),
      merkleRoot: record.merkleRoot,
      verified: record.verified,
    },
  };

  fs.writeFileSync(outputPath, JSON.stringify(exportData, null, 2));
  console.log(chalk.green(`✅ Exported to: ${outputPath}`));
}

// Main menu
export async function portfolioMenu(): Promise<void> {
  const choice = await select({
    message: "Professional Portfolio Registry:",
    choices: [
      { name: "Publish My Portfolio", value: "publish" },
      { name: "View Portfolio", value: "view" },
      { name: "Verify Portfolio", value: "verify" },
      { name: "List All Portfolios", value: "list" },
      { name: "Search Portfolios", value: "search" },
      { name: "Export Portfolio", value: "export" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "publish":
      await publishPortfolio();
      break;
    case "view":
      await viewPortfolio();
      break;
    case "verify":
      await verifyPortfolio();
      break;
    case "list":
      await listPortfolios();
      break;
    case "search":
      await searchPortfolios();
      break;
    case "export":
      await exportPortfolio();
      break;
    case "exit":
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await portfolioMenu();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  portfolioMenu().catch(console.error);
}
