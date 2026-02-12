#!/usr/bin/env node
/**
 * verify-imports.mjs
 * 
 * A guardrail script to verify that all ES module import paths in the codebase
 * resolve correctly. Run this after moving files to catch broken imports early.
 * 
 * Usage:
 *   node scripts/verify-imports.mjs
 *   node scripts/verify-imports.mjs --fix  (NOT IMPLEMENTED - just shows what needs fixing)
 * 
 * This script:
 * 1. Scans all .js files in src/
 * 2. Extracts all relative import paths (static and dynamic)
 * 3. Resolves each path relative to the importing file
 * 4. Reports any imports that point to non-existent files
 * 
 * @version 1.0.0
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { resolve, dirname, join, relative, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/** Project root (one level up from scripts/) */
const PROJECT_ROOT = resolve(__dirname, '..');

/** Source directory */
const SRC_DIR = join(PROJECT_ROOT, 'src');

/** Regex patterns for extracting import paths */
const IMPORT_PATTERNS = [
  // Static imports: import { x } from "./path.js"
  /import\s+(?:[\w\s{},*]+\s+from\s+)?["'](\.[^"']+)["']/g,
  // Dynamic imports: await import("./path.js") or import("./path.js")
  /import\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  // Re-exports: export { x } from "./path.js" or export * from "./path.js"
  /export\s+(?:[\w\s{},*]+\s+from\s+)?["'](\.[^"']+)["']/g
];

/**
 * Recursively get all .js files in a directory
 * @param {string} dir - Directory to scan
 * @returns {Promise<string[]>} - Array of absolute file paths
 */
async function getJsFiles(dir) {
  const files = [];
  const entries = await readdir(dir, { withFileTypes: true });
  
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      // Skip node_modules if it exists
      if (entry.name !== 'node_modules') {
        files.push(...await getJsFiles(fullPath));
      }
    } else if (entry.isFile() && extname(entry.name) === '.js') {
      files.push(fullPath);
    }
  }
  
  return files;
}

/**
 * Extract all relative import paths from a file
 * @param {string} content - File content
 * @returns {Array<{path: string, line: number}>} - Array of import info
 */
function extractImports(content) {
  const imports = [];
  const lines = content.split('\n');
  
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    
    for (const pattern of IMPORT_PATTERNS) {
      // Reset regex state
      pattern.lastIndex = 0;
      let match;
      
      while ((match = pattern.exec(line)) !== null) {
        const importPath = match[1];
        // Only track relative imports (starting with . or ..)
        if (importPath.startsWith('.')) {
          imports.push({
            path: importPath,
            line: i + 1,
            lineContent: line.trim()
          });
        }
      }
    }
  }
  
  return imports;
}

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    const s = await stat(filePath);
    return s.isFile();
  } catch {
    return false;
  }
}

/**
 * Verify all imports in a file
 * @param {string} filePath - Absolute path to the file
 * @returns {Promise<Array<{importPath: string, resolvedPath: string, line: number, lineContent: string}>>}
 */
async function verifyFileImports(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const imports = extractImports(content);
  const errors = [];
  
  const fileDir = dirname(filePath);
  
  for (const imp of imports) {
    const resolvedPath = resolve(fileDir, imp.path);
    const exists = await fileExists(resolvedPath);
    
    if (!exists) {
      errors.push({
        importPath: imp.path,
        resolvedPath: relative(PROJECT_ROOT, resolvedPath),
        line: imp.line,
        lineContent: imp.lineContent
      });
    }
  }
  
  return errors;
}

/**
 * Suggest a fix for a broken import
 * @param {string} filePath - The file with the broken import
 * @param {string} importPath - The broken import path
 * @returns {string|null} - Suggested fix or null
 */
function suggestFix(filePath, importPath) {
  // Common fix: file was moved one level deeper, needs one more ../
  const fileName = importPath.split('/').pop();
  
  // If import starts with ../, try adding another ../
  if (importPath.startsWith('../')) {
    return '../' + importPath;
  }
  
  // If import starts with ./, try ../ instead
  if (importPath.startsWith('./')) {
    return '..' + importPath.slice(1);
  }
  
  return null;
}

/**
 * Main entry point
 */
async function main() {
  console.log('🔍 Import Path Verification Tool');
  console.log('================================\n');
  console.log(`Scanning: ${SRC_DIR}\n`);
  
  const files = await getJsFiles(SRC_DIR);
  console.log(`Found ${files.length} JavaScript files\n`);
  
  let totalErrors = 0;
  const errorsByFile = new Map();
  
  for (const file of files) {
    const errors = await verifyFileImports(file);
    if (errors.length > 0) {
      errorsByFile.set(relative(PROJECT_ROOT, file), errors);
      totalErrors += errors.length;
    }
  }
  
  if (totalErrors === 0) {
    console.log('✅ All import paths are valid!\n');
    console.log('No broken imports found.');
    return 0;
  }
  
  console.log(`❌ Found ${totalErrors} broken import(s) in ${errorsByFile.size} file(s)\n`);
  console.log('─'.repeat(80) + '\n');
  
  for (const [file, errors] of errorsByFile) {
    console.log(`📄 ${file}`);
    
    for (const err of errors) {
      console.log(`   Line ${err.line}: "${err.importPath}"`);
      console.log(`   ├─ Resolves to: ${err.resolvedPath} (NOT FOUND)`);
      
      const suggestion = suggestFix(file, err.importPath);
      if (suggestion) {
        console.log(`   └─ Suggestion: Try "${suggestion}" instead`);
      }
      console.log();
    }
    
    console.log();
  }
  
  console.log('─'.repeat(80));
  console.log('\n💡 Common causes of broken imports:');
  console.log('   - File was moved to a subdirectory (need more ../)');
  console.log('   - Target file was renamed or deleted');
  console.log('   - Typo in the import path');
  console.log('   - Missing .js extension\n');
  
  return 1;
}

// Run
main()
  .then(code => process.exit(code))
  .catch(err => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
