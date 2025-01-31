import pkg from 'elliptic';
import { writeFile } from 'fs/promises';
import { resolve } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const { ec: EC } = pkg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Initialize secp256k1 curve
const secp256k1 = new EC('secp256k1');

// Node IDs to generate keys for
const nodes = ['SIGNER1', 'SIGNER2', 'SIGNER3', 'ENTITY1'];

// Generate key pairs
const keyPairs = nodes.map(nodeId => {
  const keyPair = secp256k1.genKeyPair();
  return {
    nodeId,
    privateKey: keyPair.getPrivate('hex').padStart(64, '0'),
    publicKey: keyPair.getPublic('hex')
  };
});

// Generate .env content
const envContent = `# Test private/public key pairs - DO NOT USE IN PRODUCTION
${keyPairs.map(({ nodeId, privateKey, publicKey }) => `
# ${nodeId}
SIGNER_PRIVATE_KEY_${nodeId}=${privateKey}
SIGNER_PUBLIC_KEY_${nodeId}=${publicKey}`).join('\n')}
`;

// Write to .env file
await writeFile(resolve(__dirname, '../.env'), envContent);

// Also output the keys to console
console.log('Generated key pairs:');
keyPairs.forEach(({ nodeId, privateKey, publicKey }) => {
  console.log(`\n${nodeId}:`);
  console.log(`Private: ${privateKey}`);
  console.log(`Public:  ${publicKey}`);
}); 