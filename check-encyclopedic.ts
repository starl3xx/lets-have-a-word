import { db } from "./src/db";
import { sql } from "drizzle-orm";

async function checkProgress() {
  const fid = 2077684;

  // Get distinct first letters this user has guessed
  const result = await db.execute<{ letter: string }>(sql`
    SELECT DISTINCT UPPER(LEFT(word, 1)) as letter
    FROM guesses
    WHERE fid = ${fid}
    AND word ~ '^[A-Za-z]'
    ORDER BY letter
  `);

  const guessedLetters = new Set(result.map((r) => r.letter));
  const allLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");
  const missingLetters = allLetters.filter(l => !guessedLetters.has(l));

  console.log("FID:", fid);
  console.log("Letters guessed:", guessedLetters.size, "/ 26");
  console.log("Guessed:", [...guessedLetters].sort().join(", "));
  console.log("Missing:", missingLetters.join(", ") || "NONE - should have badge!");
}

checkProgress().then(() => process.exit(0));
