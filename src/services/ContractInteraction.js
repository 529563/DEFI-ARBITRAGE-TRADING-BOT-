const { ethers } = require('ethers');
const config = require('../config/config');
const logger = require('../utils/logger');

class ContractInteraction {
    constructor() {
        this.provider = null;
        this.wallet = null;
        this.arbitrageContract = null;
        this.initialized = false;
    }

    async initialize() {
        try {
            // Initialize provider
            this.provider = new ethers.JsonRpcProvider(config.blockchain.networks.ethereum.rpcUrl);
            
            // Initialize wallet
            this.wallet = new ethers.Wallet(config.blockchain.privateKey, this.provider);
            
            // Initialize arbitrage contract
            const contractABI = this.getArbitrageContractABI();
            this.arbitrageContract = new ethers.Contract(
                config.blockchain.contractAddress,
                contractABI,
                this.wallet
            );

            // Test connection
            const network = await this.provider.getNetwork();
            logger.info(`Connected to network: ${network.name} (${network.chainId})`);
            
            // Check wallet balance
            const balance = await this.provider.getBalance(this.wallet.address);
            logger.info(`Wallet balance: ${ethers.formatEther(balance)} ETH`);

            this.initialized = true;
        } catch (error) {
            logger.error('Contract interaction initialization failed:', error);
            throw error;
        }
    }

    getArbitrageContractABI() {
        // Arbitrage contract ABI - should match your deployed contract
        return [
            {
                "inputs": [
                    {
                        "components": [
                            {"name": "tokenA", "type": "address"},
                            {"name": "tokenB", "type": "address"},
                            {"name": "amountIn", "type": "uint256"},
                            {"name": "dexBuy", "type": "address"},
                            {"name": "dexSell", "type": "address"},
                            {"name": "minProfitBasisPoints", "type": "uint256"},
                            {"name": "deadline", "type": "uint256"}
                        ],
                        "name": "params",
                        "type": "tuple"
                    }
                ],
                "name": "executeArbitrage",
                "outputs": [],
                "stateMutability": "nonpayable",
                "type": "function"
            },
            {
                "inputs": [],
                "name": "owner",
                "outputs": [{"name": "", "type": "address"}],
                "stateMutability": "view",
                "type": "function"
            },
            {
                "anonymous": false,
                "inputs": [
                    {"indexed": true, "name": "tokenA", "type": "address"},
                    {"indexed": true, "name": "tokenB", "type": "address"},
                    {"indexed": false, "name": "profit", "type": "uint256"},
                    {"indexed": false, "name": "gasUsed", "type": "uint256"}
                ],
                "name": "ArbitrageExecuted",
                "type": "event"
            }
        ];
    }

    async executeArbitrage(opportunity) {
        if (!this.initialized) {
            throw new Error('Contract interaction not initialized');
        }

        try {
            // Convert opportunity to contract parameters
            const params = await this.prepareArbitrageParams(opportunity);
            
            // Estimate gas
            const gasEstimate = await this.arbitrageContract.executeArbitrage.estimateGas(params);
            const gasLimit = Math.floor(Number(gasEstimate) * 1.2); // 20% buffer
            
            // Get current gas price
            const feeData = await this.provider.getFeeData();
            const gasPrice = feeData.gasPrice;
            
            // Execute transaction
            const tx = await this.arbitrageContract.executeArbitrage(params, {
                gasLimit,
                gasPrice
            });

            logger.info(`Arbitrage transaction submitted: ${tx.hash}`);
            return tx.hash;

        } catch (error) {
            logger.error('Arbitrage execution failed:', error);
            throw error;
        }
    }

    async prepareArbitrageParams(opportunity) {
        // Convert opportunity data to contract parameters
        const tokenAddresses = this.getTokenAddresses(opportunity.tokenPair);
        const dexAddresses = this.getDEXAddresses(opportunity.buyDEX, opportunity.sellDEX);
        
        return {
            tokenA: tokenAddresses.tokenA,
            tokenB: tokenAddresses.tokenB,
            amountIn: ethers.parseEther(opportunity.amount.toString()),
            dexBuy: dexAddresses.buyDEX,
            dexSell: dexAddresses.sellDEX,
            minProfitBasisPoints: Math.floor(opportunity.profitMargin * 100), // Convert to basis points
            deadline: Math.floor(Date.now() / 1000) + 300 // 5 minutes from now
        };
    }

    getTokenAddresses(tokenPair) {
        // Token address mapping - should be configured properly
        const tokenAddresses = {
            'WETH': '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
            'USDC': '0xA0b86a33E6441C4C541C4C7720c2B58d9ff5f2b5',
            'USDT': '0xdAC17F958D2ee523a2206206994597C13D831ec7',
            'DAI': '0x6B175474E89094C44Da98b954EedeAC495271d0F'
        };

        const [tokenA, tokenB] = tokenPair.split('/');
        
        return {
            tokenA: tokenAddresses[tokenA],
            tokenB: tokenAddresses[tokenB]
        };
    }

    getDEXAddresses(buyDEX, sellDEX) {
        return {
            buyDEX: config.dexes[buyDEX].router,
            sellDEX: config.dexes[sellDEX].router
        };
    }

    async waitForTransaction(transactionHash) {
        try {
            logger.info(`Waiting for transaction confirmation: ${transactionHash}`);
            
            const receipt = await this.provider.waitForTransaction(transactionHash, 1, 60000); // 1 confirmation, 60s timeout
            
            if (receipt.status === 1) {
                logger.info(`Transaction confirmed in block ${receipt.blockNumber}`);
                return receipt;
            } else {
                throw new Error('Transaction failed');
            }
        } catch (error) {
            logger.error(`Transaction wait failed: ${error.message}`);
            throw error;
        }
    }

    async simulateArbitrage(opportunity) {
        // Simulate the arbitrage transaction to check if it would succeed
        try {
            const params = await this.prepareArbitrageParams(opportunity);
            
            // Use staticCall to simulate without sending transaction
            await this.arbitrageContract.executeArbitrage.staticCall(params);
            
            return { success: true, error: null };
        } catch (error) {
            return { success: false, error: error.message };
        }
    }

    async getContractBalance(tokenAddress) {
        try {
            if (tokenAddress === ethers.ZeroAddress) {
                // ETH balance
                return await this.provider.getBalance(this.arbitrageContract.target);
            } else {
                // ERC20 token balance
                const tokenContract = new ethers.Contract(
                    tokenAddress,
                    ['function balanceOf(address) view returns (uint256)'],
                    this.provider
                );
                return await tokenContract.balanceOf(this.arbitrageContract.target);
            }
        } catch (error) {
            logger.error('Failed to get contract balance:', error);
            return 0n;
        }
    }
}

module.exports = ContractInteraction; 