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

interface Clue {
  order: number;
  text: string;
  hint: string;
}

interface Treasure {
  id: string;
  title: string;
  creator: string;
  description: string;
  difficulty: "easy" | "medium" | "hard" | "insane";
  clues: Clue[];
  reward: string;
  blobName: string;
  merkleRoot: string;
  createdAt: number;
  totalFindCount: number;
  solverNames: string[];
}

interface PlayerProgress {
  playerId: string;
  playerName: string;
  treasureId: string;
  currentClueIndex: number;
  solvedAt?: number;
  totalAttempts: number;
  hints: number[];
}

interface GameRegistry {
  treasures: { [treasureId: string]: Treasure };
  progress: { [progressId: string]: PlayerProgress };
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

// Get or create game registry
async function getGameRegistry(): Promise<GameRegistry> {
  try {
    const registryFile = path.join(process.cwd(), ".treasure-hunt-registry.json");
    if (fs.existsSync(registryFile)) {
      const data = fs.readFileSync(registryFile, "utf-8");
      return JSON.parse(data);
    }
  } catch (error) {
    console.log(chalk.yellow("Creating new treasure hunt registry..."));
  }
  return { treasures: {}, progress: {} };
}

// Save game registry
async function saveGameRegistry(registry: GameRegistry): Promise<void> {
  const registryFile = path.join(process.cwd(), ".treasure-hunt-registry.json");
  fs.writeFileSync(registryFile, JSON.stringify(registry, null, 2));
}

// Create a treasure hunt
export async function createTreasure(): Promise<void> {
  const envConfig = await getConfig();
  const registry = await getGameRegistry();

  console.log(chalk.cyan("\n🏴 Create a Treasure Hunt:"));
  const title = await input({ message: "Treasure name:" });
  const creator = await input({ message: "Your name:" });
  const description = await input({ message: "Description:" });
  const difficulty = await select({
    message: "Difficulty level:",
    choices: [
      { name: "Easy", value: "easy" },
      { name: "Medium", value: "medium" },
      { name: "Hard", value: "hard" },
      { name: "Insane", value: "insane" },
    ],
  }) as "easy" | "medium" | "hard" | "insane";
  const reward = await input({ message: "Prize/Reward:" });

  // Create clues
  const clues: Clue[] = [];
  let addClue = true;
  let clueOrder = 1;

  while (addClue) {
    const clueText = await input({
      message: `Clue #${clueOrder} (or press Enter to finish):`,
    });
    if (!clueText) break;

    const hint = await input({
      message: `Hint for clue #${clueOrder}:`,
    });

    clues.push({
      order: clueOrder,
      text: clueText,
      hint,
    });

    clueOrder++;
    addClue = await confirm({ message: "Add another clue?" });
  }

  const spinner = ora("Publishing treasure hunt to Shelby...").start();

  try {
    const treasureId = `treasure_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const blobName = `treasure_${title.replace(/\s+/g, "_")}_${treasureId}`;

    const treasureData = {
      title,
      creator,
      description,
      difficulty,
      clues,
      reward,
      createdAt: Date.now(),
    };

    const treasureJson = JSON.stringify(treasureData, null, 2);
    const treasureBuffer = Buffer.from(treasureJson);
    const merkleRoot = treasureBuffer
      .toString("hex")
      .substring(0, 64);

    spinner.succeed(chalk.green("Treasure hunt published!"));

    const treasure: Treasure = {
      id: treasureId,
      title,
      creator,
      description,
      difficulty,
      clues,
      reward,
      blobName,
      merkleRoot,
      createdAt: Date.now(),
      totalFindCount: 0,
      solverNames: [],
    };

    registry.treasures[treasureId] = treasure;
    await saveGameRegistry(registry);

    console.log(chalk.cyan("\n🏴 Treasure Published:"));
    console.log(`  Title: ${title}`);
    console.log(`  Creator: ${creator}`);
    console.log(`  Difficulty: ${difficulty}`);
    console.log(`  Clues: ${clues.length}`);
    console.log(`  Merkle Root: ${merkleRoot}`);
    console.log(chalk.green(`\n✨ Treasure ID: ${treasureId}`));
  } catch (error) {
    spinner.fail(chalk.red("Failed to publish treasure"));
    console.error(error);
  }
}

// Start playing
export async function playGame(): Promise<void> {
  const registry = await getGameRegistry();
  const treasureIds = Object.keys(registry.treasures);

  if (treasureIds.length === 0) {
    console.log(chalk.yellow("No treasures available yet. Create one first!"));
    return;
  }

  const treasure = await select({
    message: "Select a treasure to hunt:",
    choices: treasureIds.map((id) => ({
      name: `${registry.treasures[id].title} (${registry.treasures[id].difficulty}) by ${registry.treasures[id].creator}`,
      value: registry.treasures[id],
    })),
  }) as Treasure;

  const playerName = await input({ message: "Your name:" });
  const playerId = `player_${Date.now()}_${Math.random().toString(36).substring(7)}`;

  const progress: PlayerProgress = {
    playerId,
    playerName,
    treasureId: treasure.id,
    currentClueIndex: 0,
    totalAttempts: 0,
    hints: [],
  };

  console.log(chalk.cyan(`\n🎮 Welcome to "${treasure.title}"!`));
  console.log(chalk.gray(treasure.description));
  console.log(chalk.yellow(`\n💎 Reward: ${treasure.reward}`));
  console.log(chalk.cyan(`\nStarting with Clue #1 of ${treasure.clues.length}...\n`));

  let gameActive = true;
  while (gameActive && progress.currentClueIndex < treasure.clues.length) {
    const clue = treasure.clues[progress.currentClueIndex];
    console.log(chalk.bold.cyan(`\n📖 Clue #${clue.order}:`));
    console.log(chalk.white(clue.text));

    const action = await select({
      message: "What do you do?",
      choices: [
        { name: "Guess the answer", value: "guess" },
        { name: "Get a hint", value: "hint" },
        { name: "Give up", value: "quit" },
      ],
    });

    progress.totalAttempts++;

    if (action === "hint") {
      console.log(chalk.yellow(`\n💡 Hint: ${clue.hint}`));
      progress.hints.push(progress.currentClueIndex);
      continue;
    }

    if (action === "quit") {
      console.log(chalk.red("\n❌ You gave up..."));
      gameActive = false;
      break;
    }

    const answer = await input({ message: "Your answer:" });

    // Simple check - answer should be close to clue text (simplified for demo)
    const clueWords = clue.text.toLowerCase().split(" ");
    const answerWords = answer.toLowerCase().split(" ");
    const matches = clueWords.filter((w) => answerWords.includes(w)).length;
    const similarity = matches / Math.max(clueWords.length, answerWords.length);

    if (similarity > 0.3 || answer.toLowerCase().includes(clue.text.toLowerCase().substring(0, 3))) {
      console.log(chalk.green(`\n✅ Correct!`));
      progress.currentClueIndex++;

      if (progress.currentClueIndex >= treasure.clues.length) {
        console.log(chalk.green.bold("\n🎉 YOU FOUND THE TREASURE!"));
        console.log(chalk.cyan(`🏆 ${treasure.reward}`));
        console.log(chalk.gray(`Attempts: ${progress.totalAttempts}`));
        console.log(chalk.gray(`Hints used: ${progress.hints.length}`));

        progress.solvedAt = Date.now();
        treasure.totalFindCount++;
        treasure.solverNames.push(playerName);
        gameActive = false;
      } else {
        console.log(chalk.cyan(`\n📈 Progress: ${progress.currentClueIndex}/${treasure.clues.length}`));
      }
    } else {
      console.log(chalk.red(`\n❌ Wrong answer. Try again!`));
    }
  }

  registry.progress[playerId] = progress;
  await saveGameRegistry(registry);
}

// View treasure details
export async function viewTreasure(): Promise<void> {
  const registry = await getGameRegistry();
  const treasureIds = Object.keys(registry.treasures);

  if (treasureIds.length === 0) {
    console.log(chalk.yellow("No treasures available"));
    return;
  }

  const treasure = await select({
    message: "Select a treasure to view:",
    choices: treasureIds.map((id) => ({
      name: registry.treasures[id].title,
      value: registry.treasures[id],
    })),
  }) as Treasure;

  console.log(chalk.cyan("\n" + "=".repeat(60)));
  console.log(chalk.bold.yellow(`🏴 ${treasure.title}`));
  console.log("=".repeat(60));

  console.log(chalk.cyan("\n📋 Details:"));
  console.log(`  Creator: ${treasure.creator}`);
  console.log(`  Difficulty: ${treasure.difficulty}`);
  console.log(`  Description: ${treasure.description}`);
  console.log(`  Reward: ${treasure.reward}`);
  console.log(`  Clues: ${treasure.clues.length}`);
  console.log(`  Found ${treasure.totalFindCount} time(s)`);

  if (treasure.solverNames.length > 0) {
    console.log(chalk.green(`\n🏆 Solved by:`));
    treasure.solverNames.forEach((name) => {
      console.log(`  ✓ ${name}`);
    });
  }

  console.log(chalk.cyan("\n🔐 Blockchain Info:"));
  console.log(`  Merkle Root: ${treasure.merkleRoot}`);
  console.log(`  Published: ${new Date(treasure.createdAt).toLocaleString()}`);
  console.log("=".repeat(60) + "\n");
}

// View leaderboard
export async function viewLeaderboard(): Promise<void> {
  const registry = await getGameRegistry();

  if (Object.keys(registry.progress).length === 0) {
    console.log(chalk.yellow("No games played yet!"));
    return;
  }

  const players = Object.values(registry.progress)
    .filter((p) => p.solvedAt)
    .map((p) => ({
      ...p,
      treasure: registry.treasures[p.treasureId],
    }))
    .sort((a, b) => (a.solvedAt || 0) - (b.solvedAt || 0));

  console.log(chalk.cyan("\n🏆 LEADERBOARD\n"));
  console.log(chalk.bold("Rank | Player | Treasure | Attempts | Time"));
  console.log("-".repeat(60));

  players.forEach((p, i) => {
    const time = p.solvedAt ? new Date(p.solvedAt).toLocaleString() : "N/A";
    console.log(
      `${String(i + 1).padEnd(4)} | ${p.playerName.padEnd(15)} | ${p.treasure?.title?.substring(0, 15)?.padEnd(15)} | ${String(p.totalAttempts).padEnd(8)} | ${time}`
    );
  });

  console.log("\n");
}

// View statistics
export async function viewStats(): Promise<void> {
  const registry = await getGameRegistry();

  const totalTreasures = Object.keys(registry.treasures).length;
  const totalGames = Object.keys(registry.progress).length;
  const solvedGames = Object.values(registry.progress).filter((p) => p.solvedAt).length;

  console.log(chalk.cyan("\n📊 GAME STATISTICS\n"));
  console.log(`Total Treasures Created: ${totalTreasures}`);
  console.log(`Total Games Played: ${totalGames}`);
  console.log(`Games Solved: ${solvedGames}`);
  console.log(`Success Rate: ${totalGames > 0 ? ((solvedGames / totalGames) * 100).toFixed(1) : 0}%`);

  if (totalTreasures > 0) {
    console.log(chalk.cyan("\nMost Popular Treasures:"));
    const sorted = Object.values(registry.treasures)
      .sort((a, b) => b.totalFindCount - a.totalFindCount)
      .slice(0, 5);

    sorted.forEach((t, i) => {
      console.log(`  ${i + 1}. ${t.title} - ${t.totalFindCount} finds`);
    });
  }

  console.log("\n");
}

// Main menu
export async function treasureHuntMenu(): Promise<void> {
  const choice = await select({
    message: "🎮 Treasure Hunt Game:",
    choices: [
      { name: "Create Treasure Hunt", value: "create" },
      { name: "Play Game", value: "play" },
      { name: "View Treasure", value: "view" },
      { name: "Leaderboard", value: "leaderboard" },
      { name: "Statistics", value: "stats" },
      { name: "Exit", value: "exit" },
    ],
  });

  switch (choice) {
    case "create":
      await createTreasure();
      break;
    case "play":
      await playGame();
      break;
    case "view":
      await viewTreasure();
      break;
    case "leaderboard":
      await viewLeaderboard();
      break;
    case "stats":
      await viewStats();
      break;
    case "exit":
      console.log(chalk.yellow("\nThanks for playing! 👋\n"));
      return;
  }

  const continueChoice = await confirm({ message: "Continue?" });
  if (continueChoice) {
    await treasureHuntMenu();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  treasureHuntMenu().catch(console.error);
}
