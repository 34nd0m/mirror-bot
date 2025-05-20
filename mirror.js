require('dotenv').config();
const { ethers } = require('ethers');
const https = require('https');

// === Telegram alerts ===
function sendTelegram(msg) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage?chat_id=${chatId}&text=${encodeURIComponent(msg)}`;
  https.get(url).on('error', (e) => console.error('❌ Telegram error:', e.message));
}

// === Setup ===
const provider = new ethers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const abi = [
  "function swapEthForToken(uint256 amountOutMin) external payable",
  "function swapTokenForETH(address tokenIn, uint amountIn, uint amountOutMin) external"
];
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);

const watchMode = process.env.WATCH_MODE || "TOKEN";
const targetWallet = process.env.TARGET_WALLET;
const tokenAddress = process.env.TOKEN_ADDRESS;

let lastBalance;

async function getBalance() {
  if (watchMode === "ETH") {
    return await provider.getBalance(targetWallet);
  } else {
    const token = new ethers.Contract(tokenAddress, ["function balanceOf(address) view returns (uint256)"], provider);
    return await token.balanceOf(targetWallet);
  }
}

function format(units) {
  return ethers.formatUnits(units, 18);
}

function parse(units) {
  return ethers.parseUnits(units.toFixed(6), 18);
}

async function handleBuy(diff) {
  if (process.env.ENABLE_BUY !== "true") return;

  const maxEth = parseFloat(process.env.MAX_ETH_PER_TRADE || "0.05");
  const maxToken = parseFloat(process.env.MAX_TOKEN_CHANGE || "100");
  const ethAmount = parse((Number(format(diff)) / maxToken) * maxEth);

  console.log(`🧠 Mirroring BUY with ${format(ethAmount)} ETH`);
  sendTelegram(`🟢 Mirroring BUY with ${format(ethAmount)} ETH`);

  const tx = await contract.swapEthForToken(1, {
    value: ethAmount,
    gasLimit: 300000,
  });

  console.log(`✅ Buy TX sent: ${tx.hash}`);
  await tx.wait();
  console.log(`🎉 Buy confirmed`);
}

async function handleSell(diff) {
  if (process.env.ENABLE_SELL !== "true") return;

  const maxSell = parseFloat(process.env.MAX_TOKEN_SELL || "100");
  const maxEthSell = parseFloat(process.env.MAX_ETH_PER_SELL || "0.05");
  const tokenAmount = -diff;
  const proportion = Number(format(tokenAmount)) / maxSell;
  const amountToSell = parse(proportion * maxEthSell);

  console.log(`🧠 Mirroring SELL of ${format(amountToSell)} tokens`);
  sendTelegram(`🔴 Mirroring SELL of ${format(amountToSell)} tokens`);

  const tx = await contract.swapTokenForETH(tokenAddress, amountToSell, 1);
  console.log(`✅ Sell TX sent: ${tx.hash}`);
  await tx.wait();
  console.log(`🎉 Sell confirmed`);
}

async function monitor() {
  lastBalance = (await getBalance()).toString();
  console.log(`🔍 Watching ${watchMode} balance of ${targetWallet}`);
  console.log(`🔁 Polling every ${process.env.POLL_INTERVAL || 30}s`);

  setInterval(async () => {
    try {
      const newBalance = (await getBalance()).toString();

      if (newBalance !== lastBalance) {
        const prev = BigInt(lastBalance);
        const curr = BigInt(newBalance);
        const diff = curr - prev;

        if (diff > 0n) {
          console.log(`🟢 Detected IN: +${format(diff)}`);
          await handleBuy(diff);
        } else {
          console.log(`🔴 Detected OUT: -${format(-diff)}`);
          await handleSell(diff);
        }

        lastBalance = newBalance;
      } else {
        console.log("🟰 No change");
      }
    } catch (err) {
      console.error("⚠️ Monitor error:", err.message);
      sendTelegram(`⚠️ Bot error: ${err.message}`);
    }
  }, (Number(process.env.POLL_INTERVAL) || 30) * 1000);
}

monitor().catch(console.error);