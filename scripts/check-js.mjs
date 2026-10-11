import { execFileSync, spawnSync } from "node:child_process";

const files = execFileSync(
  "git",
  ["ls-files", "-z", "--", "Frontend/js"],
  { encoding: "utf8" }
)
  .split("\0")
  .filter((file) => file.endsWith(".js") && !file.startsWith("Frontend/js/vendor/"));

let failed = 0;

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8",
  });

  if (result.status === 0) {
    console.log(`PASS ${file}`);
  } else {
    failed++;
    console.error(`FAIL ${file}`);
    if (result.stderr) console.error(result.stderr.trim());
  }
}

console.log(`\nChecked ${files.length} files; ${failed} failed.`);
process.exitCode = failed === 0 && files.length > 0 ? 0 : 1;
