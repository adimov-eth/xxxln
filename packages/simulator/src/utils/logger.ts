import { pipe } from 'fp-ts/function';
import { Option, some, none } from 'fp-ts/Option';
import chalk from 'chalk';

// Log level type
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

// Log message type
export interface LogMessage {
  readonly level: LogLevel;
  readonly nodeId: string;
  readonly message: string;
  readonly data?: unknown;
  readonly timestamp: number;
}

// Broadcast function type
export type BroadcastFn = (message: string) => void;

// Color scheme - using brighter, more readable colors
const COLORS = {
  DEBUG: chalk.gray.dim,
  INFO: chalk.cyan,
  WARN: chalk.yellow,
  ERROR: chalk.red,
  HIGHLIGHT: chalk.magenta,
  SUCCESS: chalk.green,
  MUTED: chalk.gray,
  NODE_ID: chalk.blue,
  HASH: chalk.yellow,
  BLOCK: chalk.magenta,
  TRANSACTION: chalk.green,
  BALANCE: chalk.cyan,
  TIMESTAMP: chalk.gray,
  ARROW: chalk.white,
  SEPARATOR: chalk.gray,
} as const;

// Short words for better readability
const WORDS = {
  ARROW: '->',
  SEPARATOR: '|',
  DATA_START: '├',
  DATA_LINE: '│',
  TX: 'tx',
  BLOCK: 'blk',
  BALANCE: 'bal',
} as const;

// Format timestamp (more compact)
const formatTimestamp = (timestamp: number): string => {
  const time = new Date(timestamp).toISOString().split('T')[1].split('.')[0];
  return time.split(':').slice(1).join(':'); // Only show minutes:seconds
};

// Format node ID (more compact)
const formatNodeId = (nodeId: string): string => {
  const id = nodeId.replace('node_', '');
  return COLORS.NODE_ID(`[${id}]`);
};

// Format log level
const formatLevel = (level: LogLevel): string => {
  const color = COLORS[level];
  return color(level.padEnd(5));
};

// Format hash (more compact)
const formatHash = (hash: string): string =>
  COLORS.HASH(hash.substring(0, 8));

// Format block number
const formatBlockNumber = (num: number): string =>
  COLORS.BLOCK(num.toString());

// Format amount
const formatAmount = (amount: number): string =>
  COLORS.BALANCE(amount.toString().padStart(4));

// Format account (more compact)
const formatAccount = (account: string): string =>
  COLORS.TRANSACTION(account.replace('account', 'acc'));

// Format transaction
const formatTransaction = (from: string, to: string, amount: number): string =>
  `${COLORS.TRANSACTION('TRANSFER')} ${formatAccount(from)} ${COLORS.ARROW('->')} ${formatAccount(to)} ${COLORS.SEPARATOR('|')} ${formatAmount(amount)}`;

// Format message object for better readability
const formatMessageObject = (message: any): any => {
  if (!message) return message;
  
  // Format specific fields we know about
  if (message.type === 'COMMAND' && message.payload?.type === 'TRANSFER') {
    return {
      id: message.id,
      type: message.type,
      payload: {
        type: 'TRANSFER',
        from: formatAccount(message.sender),
        to: formatAccount(message.recipient),
        amount: message.payload.amount
      },
      timestamp: formatTimestamp(message.timestamp)
    };
  }
  
  return message;
};

// Custom replacer for JSON.stringify to handle BigInt and format known objects
const jsonReplacer = (key: string, value: any): any => {
  // Handle BigInt
  if (typeof value === 'bigint') {
    return value.toString();
  }
  
  // Format full messages
  if (key === 'fullMessage' || key === 'message') {
    return formatMessageObject(value);
  }
  
  // Format transaction arrays
  if (Array.isArray(value) && value.length > 0 && value[0]?.type === 'COMMAND') {
    return value.map(formatMessageObject);
  }
  
  return value;
};

// Main logger function
export const createLogger = (defaultNodeId: string = 'SYSTEM', broadcast?: BroadcastFn) => {
  const log = (level: LogLevel, message: string, nodeId?: string, data?: unknown): void => {
    const timestamp = Date.now();
    const formattedTimestamp = COLORS.TIMESTAMP(`[${formatTimestamp(timestamp)}]`);
    const formattedLevel = formatLevel(level);
    const formattedNodeId = formatNodeId(nodeId || defaultNodeId);

    // Format the message with special patterns
    const formattedMessage = message
      .replace(/#(\d+)/g, (_, num) => formatBlockNumber(parseInt(num)))
      .replace(/0x[a-f0-9]{64}/gi, hash => formatHash(hash))
      .replace(/BLOCK/g, COLORS.BLOCK('BLOCK'))
      .replace(/GENESIS/g, COLORS.HIGHLIGHT('GENESIS'))
      .replace(/account\d+/g, acc => formatAccount(acc));

    // Basic log line
    const logLine = `${formattedTimestamp} ${formattedLevel} ${formattedNodeId} ${formattedMessage}`;
    console.log(logLine);

    // If there's a broadcast function, send a plain text version
    if (broadcast) {
      const plainMessage = `${formatTimestamp(timestamp)} ${level} [${nodeId || defaultNodeId}] ${message}`;
      broadcast(plainMessage);

      if (data) {
        const plainData = typeof data === 'object' ? JSON.stringify(data, jsonReplacer, 2) : String(data);
        broadcast(`  └ Data:     ${plainData}`);
      }
    }

    // If there's additional data, format it nicely but compactly
    if (data) {
      if (typeof data === 'object') {
        const dataStr = JSON.stringify(data, jsonReplacer, 2);
        if (dataStr.length < 80) {
          // For small objects, show inline
          console.log(COLORS.MUTED('  └ '), dataStr);
          if (broadcast) broadcast(`  └ ${dataStr}`);
        } else {
          // For larger objects, show multiline
          const formattedData = dataStr
            .split('\n')
            .map(line => '    ' + line)
            .join('\n');
          console.log(COLORS.MUTED('  └ Data:'), formattedData);
          if (broadcast) broadcast(`  └ Data:\n${formattedData}`);
        }
      } else {
        console.log(COLORS.MUTED('  └ '), data);
        if (broadcast) broadcast(`  └ ${data}`);
      }
    }
  };

  return {
    debug: (message: string, nodeId?: string, data?: unknown) => 
      log('DEBUG', message, nodeId, data),
    info: (message: string, nodeId?: string, data?: unknown) => 
      log('INFO', message, nodeId, data),
    warn: (message: string, nodeId?: string, data?: unknown) => 
      log('WARN', message, nodeId, data),
    error: (message: string, nodeId?: string, data?: unknown) => 
      log('ERROR', message, nodeId, data),
    transaction: (from: string, to: string, amount: number, nodeId?: string) =>
      log('INFO', formatTransaction(from, to, amount), nodeId),
    block: (number: number, hash: string, nodeId?: string) =>
      log('INFO', `BLOCK Created ${formatBlockNumber(number)} ${COLORS.SEPARATOR('|')} ${formatHash(hash)}`, nodeId),
    balance: (account: string, amount: number, nodeId?: string) =>
      log('INFO', `BALANCE ${formatAccount(account)} ${COLORS.SEPARATOR('|')} ${formatAmount(amount)}`, nodeId),
  };
}; 