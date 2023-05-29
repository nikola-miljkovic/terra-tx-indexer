import { LCDClient, MnemonicKey } from '@terra-money/feather.js';

import Nedb from 'nedb';

function timeout(ms) {
    return new Promise(resolve => {
        if (ms == 0) {
            resolve();
        } else {
            setTimeout(resolve, ms);
        }
    });
}

const walletAddress = 'terra17c6ts8grcfrgquhj3haclg44le8s7qkx6l2yx33acguxhpf000xqhnl3je';
const transactions = new Nedb({ filename: 'db/tx.db', autoload: true });
const mk = new MnemonicKey({
    mnemonic: process.env.MNEMONIC_KEY,
});
const lcd = new LCDClient({
    // key must be the chainID
    'phoenix-1': {
        chainID: 'phoenix-1',
        lcd: 'https://phoenix-lcd.terra.dev',
        gasAdjustment: 1.75,
        gasPrices: {
            uluna: 0.015,
        },
        prefix: 'terra',
    },
});
const wallet = lcd.wallet(mk);

console.log("Starting indexing transactions for contract: " + walletAddress);

var timeoutDuration = 0;

const contractHistory = await lcd.wasm.contractHistory(walletAddress);
const initialContractHistoryEntry = contractHistory[0][0];
var blockHeight = initialContractHistoryEntry.updated.block_height;

// Continue from last TX Block - might redo some blocks :(
transactions.find({}).limit(1).exec((err, transaction) => {
    if (err !== undefined && err !== null) {
        return;
    }

    blockHeight = transaction[0].height;

    console.log("Starting from Block[" + blockHeight + "] Transaction[" + transaction[0].txhash + "]")
});

// Get latest block with transactions
var latestBlock = [];
var blockLimit = 0;

while (latestBlock.length == 0) {
    latestBlock = await lcd.tx.txInfosByHeight('phoenix-1');
}

blockLimit = latestBlock[0].height;

console.log("Block limit: Block[" + blockLimit + "]")

const _getTransactions = (blockID, resolve) => {
    lcd.tx.txInfosByHeight('phoenix-1', blockID).then((txs) => {
        txs.forEach((tx) => {
            tx.logs.forEach((txLog) => {
                if (txLog.eventsByType['wasm'] !== undefined && txLog.eventsByType['wasm']['_contract_address'] !== undefined && txLog.eventsByType['wasm']['_contract_address'].includes(walletAddress)) {
                    transactions.insert(tx, (err, tx) => {
                        console.log("Indexing Block[" + blockID + "] Transaction[" + tx.txhash + "].")
                    });
                }
            });
        });

        return resolve();
    }, async (err) => {
        console.log("Error: " + err);
        console.log("Retrying...");

        await timeout(timeoutDuration);

        await _getTransactions(blockID, resolve);
    });
};

const tryGetTransactions = async (blockID) => {
    var promise = new Promise((resolve, _) => {
        console.log("Checking block: " + blockID);

        _getTransactions(blockID, resolve);
    });

    return promise;
};

var promises = [];
var batchSize = 35;

console.log("Starting indexing with batch size: " + batchSize);

while (true) {
    promises.push(tryGetTransactions(blockHeight));

    if (promises.length >= batchSize) {
        await Promise.all(promises);
        promises = [];
    }

    blockHeight++;

    // if we reached end of indexing
    if (blockHeight == blockLimit) {
        batchSize = 1;
        timeoutDuration = 1000;
    }
};