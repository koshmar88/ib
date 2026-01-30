const blocksPerYear = 2628000;
let provider, signer;
const DEFAULT_RPC = "https://ethereum-rpc.publicnode.com/";
let readProvider = new ethers.JsonRpcProvider(DEFAULT_RPC, {
  chainId: 1,
  name: "mainnet",
});
let walletConnected = false;
const GREEN = "#2ecc71",
  RED = "#e74c3c";
window.dashboardState = {
  totalLendUSD: 0,
  totalBorrowUSD: 0,
  totalCapacityUSD: 0,
  borrowLiquidityUSD: 0,
  weightedSupply: 0,
  weightedBorrow: 0,
  poolStats: {},
  tokenPricesUSD: {},
  priceOracle: null,
};
const pools = [
  {
    name: "USDT",
    address: "0x48759F220ED983dB51fA7A8C0D2AAb8f3ce4166a",
    decimals: 6,
  },
  {
    name: "DAI",
    address: "0x8e595470Ed749b85C6F7669de83EAe304C2ec68F",
    decimals: 18,
  },
  {
    name: "USDC",
    address: "0x76Eb2FE28b36B3ee97F3Adae0C69606eeDB2A37c",
    decimals: 6,
  },
  {
    name: "ETH",
    address: "0x41c84c0e2EE0b740Cf0d31F63f3B6F627DC6b393",
    decimals: 18,
    priceSymbol: "ETHUSDT",
  },
  {
    name: "stETH",
    address: "0xbC6B6c837560D1fE317eBb54E105C89f303d5AFd",
    decimals: 18,
    priceSymbol: "ETHUSDT",
  },
  {
    name: "WBTC",
    address: "0x8Fc8BFD80d6A9F17Fb98A373023d72531792B431",
    decimals: 8,
    priceSymbol: "BTCUSDT",
  },
  {
    name: "ibEUR",
    address: "0x00e5c0774A5F065c285068170b20393925C84BF3",
    decimals: 18,
  },
  {
    name: "LINK",
    address: "0xE7BFf2Da8A2f619c2586FB83938Fa56CE803aA16",
    decimals: 18,
    priceSymbol: "LINKUSDT",
  },
];
const COMPTROLLER_ADDRESS = "0xAB1c342C7bf5Ec5F02ADEA1c2270670bCa144CbB";
async function getPriceOracleAddress() {
  if (window.dashboardState.priceOracle)
    return window.dashboardState.priceOracle;
  const { value } = await tryContractCall(
    COMPTROLLER_ADDRESS,
    ["function oracle() view returns (address)"],
    (contract) => contract.oracle(),
    "oracle address",
  );
  window.dashboardState.priceOracle = value;
  return value;
}
async function fetchUnderlyingPriceUSD(ctokenAddress, underlyingDecimals) {
  try {
    const oracleAddr = await getPriceOracleAddress();
    const { value } = await tryContractCall(
      oracleAddr,
      ["function getUnderlyingPrice(address) view returns (uint256)"],
      (contract) => contract.getUnderlyingPrice(ctokenAddress),
      `underlying price ${ctokenAddress}`,
    );
    const mantissa = BigInt(value);
    const scale = 36 - underlyingDecimals;
    if (scale < 0) {
      return parseFloat(ethers.formatUnits(mantissa, 18));
    }
    return parseFloat(ethers.formatUnits(mantissa, scale));
  } catch (err) {
    console.warn(`Failed to fetch on-chain price for ${ctokenAddress}`, err);
    return null;
  }
}

const PRICE_EPS = 1e-6;
function getPoolPriceUSD(pool) {
  if (!pool.priceSymbol) return 1;
  const prices = window.dashboardState.tokenPricesUSD || {};
  const price = prices[pool.priceSymbol];
  return typeof price === "number" && !Number.isNaN(price) ? price : 0;
}
function getDisplayDecimals(pool) {
  if (pool.decimals <= 4) return pool.decimals;
  if (pool.decimals >= 18) return 4;
  return Math.min(6, pool.decimals);
}
function formatTokenDisplay(pool, baseAmount, usdAmount) {
  const decimals = getDisplayDecimals(pool);
  const baseText = baseAmount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
  const usdText = `$${usdAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (
    !pool.priceSymbol ||
    Math.abs((usdAmount || 0) - baseAmount) < PRICE_EPS
  ) {
    return `${usdText} ${pool.name}`;
  }
  if (usdAmount === 0 && baseAmount !== 0) {
    return `${baseText} ${pool.name}`;
  }
  return `${baseText} ${pool.name}<br/><small style="color:#aaa">(${usdText})</small>`;
}
function formatBorrowDisplay(pool, baseAmount, usdAmount) {
  const decimals = getDisplayDecimals(pool);
  const baseText = baseAmount.toLocaleString(undefined, {
    maximumFractionDigits: decimals,
  });
  const usdText = `$${usdAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  if (
    !pool.priceSymbol ||
    Math.abs((usdAmount || 0) - baseAmount) < PRICE_EPS
  ) {
    return `${usdAmount.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${pool.name}`;
  }
  if (usdAmount === 0 && baseAmount !== 0) {
    return `${baseText} ${pool.name}`;
  }
  return `${baseText} ${pool.name}<br/><small style="color:#aaa">(${usdText})</small>`;
}

function availableProviders() {
  return readProvider ? [readProvider] : [];
}

async function tryProviderCall(fn, context) {
  const providers = availableProviders();
  if (!providers.length) {
    throw new Error("No provider available");
  }
  let lastError;
  for (const prov of providers) {
    try {
      return { value: await fn(prov), provider: prov };
    } catch (err) {
      lastError = err;
      console.warn(
        `[ProviderRetry] ${context || "call"} failed via ${prov.connection?.url || "wallet provider"}`,
        err,
      );
    }
  }
  throw lastError || new Error(`All providers failed for ${context || "call"}`);
}

async function tryContractCall(address, abi, callback, context) {
  return await tryProviderCall(
    async (prov) => {
      const contract = new ethers.Contract(address, abi, prov);
      return await callback(contract, prov);
    },
    context || `contract ${address}`,
  );
}

function setStatus(msg) {
  document.getElementById("status").innerText = msg;
}
function updateIbeurMetrics() {
  const el = document.getElementById("ibeur-price");
  if (!el) return;
  const pool = pools.find((p) => p.name === "ibEUR");
  if (!pool) {
    el.textContent = "";
    return;
  }
  const stats = window.dashboardState.poolStats?.[pool.address];
  if (!stats) {
    el.innerHTML = "ibEUR: connect wallet to load pool data.";
    return;
  }
  const price = stats.priceUSD;
  const borrowLimitUSD = window.dashboardState.borrowLiquidityUSD;
  let cashBase = 0;
  try {
    cashBase = parseFloat(ethers.formatUnits(stats.cash, pool.decimals));
  } catch {
    cashBase = 0;
  }
  const priceOk = typeof price === "number" && price > 0;
  const liquidityUSDT = priceOk ? cashBase * price : null;
  const borrowLimitIbeur =
    priceOk && typeof borrowLimitUSD === "number"
      ? borrowLimitUSD / price
      : null;
  const lines = [];
  if (priceOk) {
    lines.push(`1 ibEUR ≈ ${price.toFixed(4)} USDT`);
  } else {
    lines.push("1 ibEUR ≈ N/A");
  }
  if (liquidityUSDT !== null) {
    lines.push(`ibEUR pool liquidity ≈ ${liquidityUSDT.toFixed(2)} USDT`);
  }
  if (typeof borrowLimitUSD === "number") {
    if (borrowLimitIbeur !== null) {
      lines.push(
        `Your borrow limit: ${borrowLimitUSD.toFixed(2)} USDT (~${borrowLimitIbeur.toFixed(2)} ibEUR)`,
      );
    } else {
      lines.push(`Your borrow limit: ${borrowLimitUSD.toFixed(2)} USDT`);
    }
  }
  el.innerHTML = lines.join("<br/>");
}
function updateUsage(cur, pred) {
  const u = document.getElementById("usage-bar");
  u.style.width = cur + "%";
  u.style.background = cur <= 90 ? GREEN : RED;
  document.getElementById("credit-usage").firstChild.nodeValue =
    `Credit Usage: ${cur.toFixed(2)}% of max`;
  const pb = document.getElementById("predicted-bar");
  pb.style.width = pred + "%";
  pb.style.background = pred <= 90 ? GREEN : RED;
  document.getElementById("predicted-usage").firstChild.nodeValue =
    `Predicted Usage: ${pred.toFixed(2)}% of max`;
}
function clearPredAPY() {
  pools.forEach((p) => {
    const s = document.getElementById(`pred-supply-${p.address}`),
      b = document.getElementById(`pred-borrow-${p.address}`);
    if (s) s.textContent = "";
    if (b) b.textContent = "";
  });
}
function updatePredAPY(addr, sAPY, bAPY) {
  const sp = document.getElementById(`pred-supply-${addr}`);
  sp.classList.add("pred-supply");
  if (isNaN(sAPY)) {
    sp.innerHTML = "";
  } else {
    sp.innerHTML = `&nbsp;→ ${(sAPY * 100).toFixed(2)}%`;
  }
  const bp = document.getElementById(`pred-borrow-${addr}`);
  bp.classList.add("pred-borrow");
  if (isNaN(bAPY)) {
    bp.innerHTML = "";
  } else {
    bp.innerHTML = `&nbsp;→ ${(bAPY * 100).toFixed(2)}%`;
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus("❌ MetaMask not installed");
    return;
  }
  provider = new ethers.BrowserProvider(window.ethereum);
  await provider.send("eth_requestAccounts", []);
  signer = await provider.getSigner();
  walletConnected = true;
  const raw = signer.address;
  const masked = raw.slice(0, 6) + "***" + raw.slice(-4);
  document.getElementById("wallet-status").innerHTML =
    `<span style="color:#34d399">Connected: ${masked}</span>`;
  await loadPoolData();
}
function disconnectWallet() {
  provider = signer = null;
  walletConnected = false;
  window.dashboardState = {
    totalLendUSD: 0,
    totalBorrowUSD: 0,
    totalCapacityUSD: 0,
    borrowLiquidityUSD: 0,
    weightedSupply: 0,
    weightedBorrow: 0,
    poolStats: {},
    tokenPricesUSD: {},
    priceOracle: null,
  };
  document.getElementById("wallet-status").innerText = "";
  document.getElementById("data-body").innerHTML = "";
  document.getElementById("portfolio-summary").innerText =
    "Portfolio: $0.00 | Net APY: 0% | Daily: $0.00 | Hourly: $0.00";
  updateUsage(0, 0);
  clearPredAPY();
  updateIbeurMetrics();
  setStatus("");
}

async function loadPoolData() {
  if (!signer) {
    setStatus("❌ Connect wallet first");
    return;
  }
  setStatus("🔄 Loading…");
  await fetchTokenPricesUSD();
  await updateAllCollateralFactors();
  window.dashboardState.liquidationIncentive =
    await fetchLiquidationIncentive();

  const user = signer.address;

  const abi = [
    "function getCash() view returns(uint256)",
    "function totalBorrows() view returns(uint256)",
    "function totalReserves() view returns(uint256)",
    "function borrowRatePerBlock() view returns(uint256)",
    "function supplyRatePerBlock() view returns(uint256)",
    "function exchangeRateStored() view returns(uint256)",
    "function balanceOf(address) view returns(uint256)",
    "function borrowBalanceStored(address) view returns(uint256)",
    "function interestRateModel() view returns(address)",
    "function reserveFactorMantissa() view returns(uint256)",
  ];
  let totL = 0,
    totB = 0,
    totC = 0,
    wS = 0,
    wB = 0;
  let assetsIn = [];
  try {
    assetsIn = (await getAssetsIn(user)).map((a) => a.toLowerCase());
  } catch (e) {
    assetsIn = pools.map((p) => p.address.toLowerCase());
  }

  const tbody = document.getElementById("data-body");
  tbody.innerHTML = "";

  for (const p of pools) {
    try {
      const { value: poolValues } = await tryContractCall(
        p.address,
        abi,
        (contract) =>
          Promise.all([
            contract.getCash(),
            contract.totalBorrows(),
            contract.totalReserves(),
            contract.borrowRatePerBlock(),
            contract.supplyRatePerBlock(),
            contract.exchangeRateStored(),
            contract.balanceOf(user),
            contract.borrowBalanceStored(user),
            contract.interestRateModel(),
            contract.reserveFactorMantissa(),
          ]),
        `pool core data ${p.name}`,
      );
      const [
        cash,
        borrows,
        reserves,
        brRaw,
        srRaw,
        exRate,
        cBal,
        bBal,
        modelAddr,
        resFact,
      ] = poolValues;
      const brPB = parseFloat(ethers.formatUnits(brRaw, 18));
      const srPB = parseFloat(ethers.formatUnits(srRaw, 18));
      const rf = parseFloat(ethers.formatUnits(resFact, 18));
      const borrowAPY = (1 + brPB) ** blocksPerYear - 1;
      const supplyAPY = (1 + srPB) ** blocksPerYear - 1;
      const totalSupply = cash + borrows - reserves;
      const utilization = totalSupply === 0n
        ? 0
        : Number((borrows * 10000n) / totalSupply) / 100;
      const previousStats = window.dashboardState.poolStats[p.address] || {};
      const onChainPrice = await fetchUnderlyingPriceUSD(p.address, p.decimals);
      let priceUSD = onChainPrice !== null ? onChainPrice : getPoolPriceUSD(p);
      if (!priceUSD && previousStats.priceUSD)
        priceUSD = previousStats.priceUSD;
      if (!priceUSD && !p.priceSymbol) priceUSD = 1;
      if (onChainPrice !== null && p.priceSymbol) {
        window.dashboardState.tokenPricesUSD[p.priceSymbol] = onChainPrice;
      }
      const toBase = (valBN) =>
        parseFloat(ethers.formatUnits(valBN, p.decimals));
      const lendUnderlying = cBal
        * exRate
        / 1000000000000000000n;
      const baseLend = toBase(lendUnderlying);
      const baseBorrow = toBase(bBal);
      const baseCash = toBase(cash);
      const baseTotalSupply = toBase(totalSupply);
      const baseBorrows = toBase(borrows);
      const baseReserves = toBase(reserves);
      const usdLend = baseLend * priceUSD;
      const usdBorrow = baseBorrow * priceUSD;
      const usdCash = baseCash * priceUSD;
      const usdTotalSupply = baseTotalSupply * priceUSD;
      const usdBorrows = baseBorrows * priceUSD;
      const usdReserves = baseReserves * priceUSD;
      totL += usdLend;
      totB += usdBorrow;
      if (assetsIn.includes(p.address.toLowerCase()) && usdLend > 0) {
        totC += usdLend * p.collateralFactor;
      }
      wS += usdLend * supplyAPY;
      wB += usdBorrow * borrowAPY;
      window.dashboardState.poolStats[p.address] = {
        cash,
        borrows,
        reserves,
        modelAddr,
        resFact,
        exchangeRate: exRate,
        brPB,
        srPB,
        rf,
        supplyAPY,
        borrowAPY,
        util: utilization / 100,
        decimals: p.decimals,
        collateralFactor: p.collateralFactor,
        priceUSD,
      };
      const formatValue = (bn, baseOverride, usdOverride) => {
        const baseAmount =
          baseOverride !== undefined ? baseOverride : toBase(bn);
        const usdAmount =
          usdOverride !== undefined ? usdOverride : baseAmount * priceUSD;
        return formatTokenDisplay(p, baseAmount, usdAmount);
      };
      const borrowText = formatBorrowDisplay(p, baseBorrow, usdBorrow);

      const isCollateral = assetsIn.includes(p.address.toLowerCase());
      const collateralCell = isCollateral
        ? '<span style="color:#2ecc71;font-weight:bold;">✔ Enabled</span>'
        : `<button onclick="enableCollateral('${p.address}')">Enable</button>`;

      const row = document.createElement("tr");
      row.innerHTML = `
            <td data-label="Token">${p.name}</td>
            <td data-label="Liquidity" class="liquidity-value">${formatValue(cash, baseCash, usdCash)}</td>
            <td data-label="Total Supply">${formatValue(totalSupply, baseTotalSupply, usdTotalSupply)}</td>
            <td data-label="Supply APY" class="supply-apy">${(supplyAPY * 100).toFixed(2)}% <em id="pred-supply-${p.address}"></em></td>
            <td data-label="Total Borrow">${formatValue(borrows, baseBorrows, usdBorrows)}</td>
            <td data-label="Borrow APY" class="borrow-apy">${(borrowAPY * 100).toFixed(2)}% <em id="pred-borrow-${p.address}"></em></td>
            <td data-label="Reserves">${formatValue(reserves, baseReserves, usdReserves)}</td>
            <td data-label="Utilization">${utilization.toFixed(2)}%</td>
            <td data-label="Your Lend" class="your-lend">${formatValue(lendUnderlying, baseLend, usdLend)}</td>
            <td data-label="Your Borrow" class="your-borrow">${borrowText}</td>
            <td data-label="Actions">
              <input id="supply-${p.address}" placeholder="Supply"/><button onclick="supply('${p.address}',${p.decimals})">Supply</button><br/>
              <input id="withdraw-${p.address}" placeholder="Redeem"/><button onclick="withdraw('${p.address}',${p.decimals})">Redeem</button><br/>
              <input id="borrow-${p.address}" placeholder="Borrow"/><button onclick="borrow('${p.address}',${p.decimals})">Borrow</button><br/>
              <input id="repay-${p.address}" placeholder="Repay"/><button onclick="repay('${p.address}',${p.decimals})">Repay</button><br/>
              <button onclick="preview('${p.address}')">Preview</button>
              <button onclick="updatePool('${p.address}')">Update</button>
            </td>
            <td data-label="Collateral">${collateralCell}</td>`;

      tbody.appendChild(row);
    } catch (e) {
      console.error(e);
    }
  }
  window.dashboardState.totalLendUSD = totL;
  window.dashboardState.totalBorrowUSD = totB;
  window.dashboardState.totalCapacityUSD = totC;
  window.dashboardState.weightedSupply = wS;
  window.dashboardState.weightedBorrow = wB;
  const myNet = totL - totB;
  const netAPY = myNet !== 0 ? (wS - wB) / Math.abs(myNet) : 0;
  const daily = (myNet * netAPY) / 365;
  const hourly = daily / 24;
  const borrowLimit = totC;
  const liquidationIncentive =
    window.dashboardState.liquidationIncentive || 1.05;
  const realBorrowLimit = borrowLimit / liquidationIncentive;
  const borrowAvailable = Math.max(realBorrowLimit - totB, 0);
  const userAddress = signer.address;
  const borrowLimitFromComptroller = await fetchBorrowLimit(userAddress); // USD, сколько еще можно взять
  window.dashboardState.borrowLiquidityUSD = borrowLimitFromComptroller;
  const usage =
    totB + borrowLimitFromComptroller > 0
      ? (totB / (totB + borrowLimitFromComptroller)) * 100
      : 0;
  const ethPool = pools.find((item) => item.name === "ETH");
  let ethPrice = 0;
  if (ethPool && ethPool.priceSymbol) {
    ethPrice =
      window.dashboardState.tokenPricesUSD[ethPool.priceSymbol] ||
      window.dashboardState.poolStats[ethPool.address]?.priceUSD ||
      0;
  }
  const borrowLimitETH =
    ethPrice > 0 ? borrowLimitFromComptroller / ethPrice : 0;

  document.getElementById("portfolio-summary").innerHTML =
    `Portfolio: $${myNet.toFixed(2)} | Net APY: ${(netAPY * 100).toFixed(2)}% | Daily: $${daily.toFixed(2)} | Hourly: $${hourly.toFixed(2)} | Borrow Limit: $${borrowLimitFromComptroller.toFixed(2)}<br>` +
    `<span style="color:#fff;font-size:1.3em;font-weight:bold;">Borrow Limit: ${borrowLimitETH.toFixed(4)} ETH</span>`;
  updateUsage(usage, usage);
  updateIbeurMetrics();
  clearPredAPY();
  setStatus("");
  // history tracking removed
}

function updatePredictedPortfolio(myNet, netAPY, daily, hourly) {
  let el = document.getElementById("predicted-portfolio");
  if (!el) {
    el = document.createElement("div");
    el.id = "predicted-portfolio";
    el.style.textAlign = "center";
    el.style.fontWeight = "bold";
    el.style.margin = "10px 0";
    el.style.color = "#ffe066";
    document.getElementById("portfolio-summary").after(el);
  }
  el.innerText = `Predicted Portfolio: $${myNet.toFixed(2)} | Net APY: ${(netAPY * 100).toFixed(2)}% | Daily: $${daily.toFixed(2)} | Hourly: $${hourly.toFixed(2)}`;
}

async function preview(addr) {
  const p = pools.find((x) => x.address === addr);
  const parseInput = (id, dec) => {
    const el = document.getElementById(id);
    if (!el || !el.value.trim()) return 0n;
    const val = parseFloat(el.value);
    return !val
      ? 0n
      : ethers.parseUnits(val.toString(), dec);
  };
  const sup = parseInput(`supply-${addr}`, p.decimals);
  const bor = parseInput(`borrow-${addr}`, p.decimals);
  const rep = parseInput(`repay-${addr}`, p.decimals);
  const wit = parseInput(`withdraw-${addr}`, p.decimals);
  if (sup === 0n && bor === 0n && rep === 0n && wit === 0n) {
    updatePredAPY(addr, NaN, NaN);
    setStatus("");
    return;
  }
  const stats = window.dashboardState.poolStats[addr];
  if (!stats) {
    updatePredAPY(addr, NaN, NaN);
    setStatus("❌ Preview error");
    return;
  }
  let blocksElapsed;
  try {
    const { value: accrual } = await tryContractCall(
      addr,
      ["function accrualBlockNumber() view returns(uint256)"],
      (contract) => contract.accrualBlockNumber(),
      `accrualBlockNumber ${p.name}`,
    );
    const { value: curr } = await tryProviderCall(
      (prov) => prov.getBlockNumber(),
      "blockNumber",
    );
    blocksElapsed = curr - accrual;
    if (blocksElapsed < 1n) blocksElapsed = 1n;
  } catch {
    blocksElapsed = 1n;
  }
  const { value: brPrev } = await tryContractCall(
    stats.modelAddr,
    ["function getBorrowRate(uint256,uint256,uint256) view returns(uint256)"],
    (contract) =>
      contract.getBorrowRate(stats.cash, stats.borrows, stats.reserves),
    `borrowRate ${p.name}`,
  );
  const interest = stats.borrows
    * brPrev
    * blocksElapsed
    / ethers.parseUnits("1", 18);
  const safeSub = (a, b) => (a > b ? a - b : 0n);
  const newBor = safeSub(stats.borrows + interest + bor, rep);
  const newCash = safeSub(stats.cash + sup + rep, wit + bor);
  const newRes = stats.reserves + (
    interest * stats.resFact / ethers.parseUnits("1", 18)
  );
  try {
    const {
      value: [brRaw, srRaw],
    } = await tryContractCall(
      stats.modelAddr,
      [
        "function getBorrowRate(uint256,uint256,uint256) view returns(uint256)",
        "function getSupplyRate(uint256,uint256,uint256,uint256) view returns(uint256)",
      ],
      (contract) =>
        Promise.all([
          contract.getBorrowRate(newCash, newBor, newRes),
          contract.getSupplyRate(newCash, newBor, newRes, stats.resFact),
        ]),
      `preview rates ${p.name}`,
    );
    const brPB = parseFloat(ethers.formatUnits(brRaw, 18));
    const srPB = parseFloat(ethers.formatUnits(srRaw, 18));
    updatePredAPY(
      addr,
      Math.pow(1 + srPB, blocksPerYear) - 1,
      Math.pow(1 + brPB, blocksPerYear) - 1,
    );
    setStatus("✅ Preview calculated");
  } catch {
    updatePredAPY(addr, NaN, NaN);
    setStatus("❌ Preview error");
  }
}
async function previewAll() {
  await fetchTokenPricesUSD();
  if (!signer) {
    setStatus("❌ Connect wallet first");
    return;
  }
  if (!Object.keys(window.dashboardState.poolStats || {}).length) {
    await loadPoolData();
  }
  setStatus("🔄 Calculating preview…");
  await updateAllCollateralFactors();
  window.dashboardState.liquidationIncentive =
    await fetchLiquidationIncentive();
  const user = signer.address;
  let totL = 0,
    totB = 0,
    totC = 0,
    wS = 0,
    wB = 0;
  let predL = 0,
    predB = 0,
    predWS = 0,
    predWB = 0;
  const baseBorrowUSD = window.dashboardState.totalBorrowUSD || 0;
  const baseLiquidityUSD = window.dashboardState.borrowLiquidityUSD || 0;
  let borrowDeltaUSD = 0;
  let collateralDeltaUSD = 0;
  let currentCollateralTotal = 0;
  let assetsIn = [];
  try {
    assetsIn = (await getAssetsIn(user)).map((a) => a.toLowerCase());
  } catch (e) {
    assetsIn = pools.map((p) => p.address.toLowerCase());
  }

  for (const pool of pools) {
    const stats = window.dashboardState.poolStats[pool.address];
    if (!stats) {
      console.warn("Missing pool stats for previewAll", pool.address);
      continue;
    }
    // parse user inputs
    const parseInput = (id) => {
      const el = document.getElementById(id);
      if (!el || !el.value.trim()) return 0n;
      const val = parseFloat(el.value);
      return isNaN(val) || val <= 0
        ? 0n
        : ethers.parseUnits(val.toString(), pool.decimals);
    };
    const sup = parseInput(`supply-${pool.address}`);
    const bor = parseInput(`borrow-${pool.address}`);
    const rep = parseInput(`repay-${pool.address}`);
    const wit = parseInput(`withdraw-${pool.address}`);

    // current balances
    const {
      value: [cBal, bBal, exRate],
    } = await tryContractCall(
      pool.address,
      [
        "function balanceOf(address) view returns(uint256)",
        "function borrowBalanceStored(address) view returns(uint256)",
        "function exchangeRateStored() view returns(uint256)",
      ],
      (contract) =>
        Promise.all([
          contract.balanceOf(user),
          contract.borrowBalanceStored(user),
          contract.exchangeRateStored(),
        ]),
      `balances ${pool.name}`,
    );
    const toBase = (bn) =>
      parseFloat(ethers.formatUnits(bn, pool.decimals));
    const lendUnderlying = cBal
      * exRate
      / 1000000000000000000n;
    const baseLend = toBase(lendUnderlying);
    const baseBorrow = toBase(bBal);
    let priceUSD = (stats && stats.priceUSD) || getPoolPriceUSD(pool);
    if (!priceUSD && !pool.priceSymbol) priceUSD = 1;
    const lendUSD = baseLend * priceUSD;
    const borrowUSD = baseBorrow * priceUSD;

    totL += lendUSD;
    totB += borrowUSD;
    let currentCollateralUSD = 0;
    if (assetsIn.includes(pool.address.toLowerCase()) && lendUSD > 0) {
      currentCollateralUSD = lendUSD * pool.collateralFactor;
      totC += currentCollateralUSD;
    }
    currentCollateralTotal += currentCollateralUSD;
    const supplyAPY = stats?.supplyAPY || 0;
    const borrowAPY = stats?.borrowAPY || 0;
    wS += lendUSD * supplyAPY;
    wB += borrowUSD * borrowAPY;

    const supplyDelta = sup !== 0n ? toBase(sup) : 0;
    const withdrawDelta = wit !== 0n ? toBase(wit) : 0;
    let predictedLendBase = baseLend + supplyDelta - withdrawDelta;
    if (predictedLendBase < 0) predictedLendBase = 0;
    const predictedLendUSD = predictedLendBase * priceUSD;
    predL += predictedLendUSD;

    const borrowDelta = bor !== 0n ? toBase(bor) : 0;
    const repayDelta = rep !== 0n ? toBase(rep) : 0;
    let predictedBorrowBase = baseBorrow + borrowDelta - repayDelta;
    if (predictedBorrowBase < 0) predictedBorrowBase = 0;
    const predictedBorrowUSD = predictedBorrowBase * priceUSD;
    predB += predictedBorrowUSD;

    let predictedCollateralUSDForPool = 0;
    if (assetsIn.includes(pool.address.toLowerCase()) && predictedLendUSD > 0) {
      predictedCollateralUSDForPool = predictedLendUSD * pool.collateralFactor;
    }
    collateralDeltaUSD += predictedCollateralUSDForPool - currentCollateralUSD;
    borrowDeltaUSD += predictedBorrowUSD - borrowUSD;

    // interest accrual & new rates
    let blocksElapsed;
    try {
      const { value: accrual } = await tryContractCall(
        pool.address,
        ["function accrualBlockNumber() view returns(uint256)"],
        (contract) => contract.accrualBlockNumber(),
        `accrualBlockNumber ${pool.name}`,
      );
      const { value: curr } = await tryProviderCall(
        (prov) => prov.getBlockNumber(),
        "blockNumber",
      );
      blocksElapsed = curr - accrual;
      if (blocksElapsed < 1n) blocksElapsed = 1n;
    } catch {
      blocksElapsed = 1n;
    }
    // accrue interest
    const { value: brPrev } = await tryContractCall(
      stats.modelAddr,
      ["function getBorrowRate(uint256,uint256,uint256) view returns(uint256)"],
      (contract) =>
        contract.getBorrowRate(stats.cash, stats.borrows, stats.reserves),
      `borrowRate ${pool.name}`,
    );
    const interest = stats.borrows
      * brPrev
      * blocksElapsed
      / ethers.parseUnits("1", 18);

    const safeSub = (a, b) => (a > b ? a - b : 0n);
    const newBor = safeSub(stats.borrows + interest + bor, rep);
    const newCash = safeSub(stats.cash + sup + rep, wit + bor);
    const newRes = stats.reserves + (
      interest * stats.resFact / ethers.parseUnits("1", 18)
    );

    try {
      const {
        value: [brRaw, srRaw],
      } = await tryContractCall(
        stats.modelAddr,
        [
          "function getBorrowRate(uint256,uint256,uint256) view returns(uint256)",
          "function getSupplyRate(uint256,uint256,uint256,uint256) view returns(uint256)",
        ],
        (contract) =>
          Promise.all([
            contract.getBorrowRate(newCash, newBor, newRes),
            contract.getSupplyRate(newCash, newBor, newRes, stats.resFact),
          ]),
        `previewAll rates ${pool.name}`,
      );
      const brPB = parseFloat(ethers.formatUnits(brRaw, 18));
      const srPB = parseFloat(ethers.formatUnits(srRaw, 18));
      const borrowAPYPred = Math.pow(1 + brPB, blocksPerYear) - 1;
      const supplyAPYPred = Math.pow(1 + srPB, blocksPerYear) - 1;
      updatePredAPY(pool.address, supplyAPYPred, borrowAPYPred);
      predWS += predictedLendUSD * supplyAPYPred;
      predWB += predictedBorrowUSD * borrowAPYPred;
    } catch {}
  }

  const liquidationIncentive =
    window.dashboardState.liquidationIncentive || 1.05;
  const predictedBorrowUSDTotal = Math.max(baseBorrowUSD + borrowDeltaUSD, 0);
  const predictedCollateralUSDTotal = Math.max(
    currentCollateralTotal + collateralDeltaUSD,
    0,
  );
  const liquidityDeltaUSD =
    collateralDeltaUSD / liquidationIncentive - borrowDeltaUSD;
  const predictedLiquidityUSD = Math.max(
    baseLiquidityUSD + liquidityDeltaUSD,
    0,
  );
  predB = predictedBorrowUSDTotal;

  // final portfolio prediction
  const myNet = predL - predB;
  const netAPY = myNet ? (predWS - predWB) / Math.abs(myNet) : 0;
  const daily = (myNet * netAPY) / 365;
  const hourly = daily / 24;
  updatePredictedPortfolio(myNet, netAPY, daily, hourly);

  // usage
  const curUsageDenom = baseBorrowUSD + baseLiquidityUSD;
  const curUsage =
    curUsageDenom > 0 ? (baseBorrowUSD / curUsageDenom) * 100 : 0;

  const predUsageDenom = predictedBorrowUSDTotal + predictedLiquidityUSD;
  const predUsage =
    predUsageDenom > 0
      ? (predictedBorrowUSDTotal / predUsageDenom) * 100
      : predictedBorrowUSDTotal > 0
        ? 100
        : 0;

  updateUsage(curUsage, predUsage);
  setStatus("✅ Preview all calculated");
}
async function supply(addr, dec) {
  const val = document.getElementById(`supply-${addr}`).value;
  if (!val) return alert("Enter amount");
  setStatus("⏳ Approving & supplying...");
  try {
    const c = new ethers.Contract(
      addr,
      [
        "function underlying() view returns(address)",
        "function mint(uint256) returns(uint256)",
      ],
      signer,
    );
    let underlying;
    try {
      underlying = await c.underlying();
    } catch {
      // USDT cToken uses Tether underlying
      if (addr.toLowerCase() === "0x48759f220ed983db51fa7a8c0d2aab8f3ce4166a") {
        underlying = "0xdAC17F958D2ee523a2206206994597C13D831ec7";
      } else {
        throw new Error("Unable to fetch underlying token address");
      }
    }
    const erc20 = new ethers.Contract(
      underlying,
      [
        "function allowance(address,address) view returns(uint256)",
        "function approve(address,uint256) returns(bool)",
      ],
      signer,
    );
    const owner = signer.address;
    const amt = ethers.parseUnits(val, dec);
    // Only approve new amount if current allowance is insufficient
    const currentAllowance = await erc20.allowance(owner, addr);
    if (currentAllowance < amt) {
      await (await erc20.approve(addr, amt)).wait();
    }
    // Now mint cTokens
    await (await c.mint(amt)).wait();
    setStatus("✅ Supply done");
    loadPoolData();
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}
async function borrow(addr, dec) {
  const val = document.getElementById(`borrow-${addr}`).value;
  if (!val) return alert("Enter amount");
  setStatus("⏳ Borrowing...");
  try {
    const c = new ethers.Contract(
      addr,
      ["function borrow(uint256) returns(uint256)"],
      signer,
    );
    const amt = ethers.parseUnits(val, dec);
    await (await c.borrow(amt)).wait();
    setStatus("✅ Borrow done");
    loadPoolData();
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}
async function repay(addr, dec) {
  const val = document.getElementById(`repay-${addr}`).value;
  if (!val) return alert("Enter amount");
  setStatus("⏳ Approving & repaying...");
  try {
    const c = new ethers.Contract(
      addr,
      [
        "function repayBorrow(uint256) returns(uint256)",
        "function underlying() view returns(address)",
      ],
      signer,
    );
    let underlying;
    try {
      underlying = await c.underlying();
    } catch {
      underlying = addr;
    }
    const erc20 = new ethers.Contract(
      underlying,
      [
        "function allowance(address,address) view returns(uint256)",
        "function approve(address,uint256) returns(bool)",
      ],
      signer,
    );
    const owner = signer.address;
    const amt = ethers.parseUnits(val, dec);
    const currentAllowance = await erc20.allowance(owner, addr);
    if (currentAllowance < amt) {
      await (await erc20.approve(addr, amt)).wait();
    }
    await (await c.repayBorrow(amt)).wait();
    setStatus("✅ Repay done");
    loadPoolData();
  } catch (e) {
    setStatus("❌ " + e.message);
  }
}
async function withdraw(addr, dec) {
  const val = document.getElementById(`withdraw-${addr}`).value;
  if (!val) return alert("Enter amount");
  setStatus("⏳ Withdrawing...");
  try {
    const abi = [
      "function redeemUnderlying(uint256) returns(uint256)",
      "function redeem(uint256) returns(uint256)",
      "function balanceOf(address) view returns(uint256)",
      "function exchangeRateCurrent() returns(uint256)",
    ];
    const c = new ethers.Contract(addr, abi, signer);
    const amt = ethers.parseUnits(val, dec);
    try {
      await (await c.redeemUnderlying(amt)).wait();
      setStatus("✅ Withdraw done");
    } catch (primaryErr) {
      const reasonText =
        [
          primaryErr?.error?.data?.message,
          primaryErr?.error?.message,
          primaryErr?.reason,
          primaryErr?.data?.message,
          primaryErr?.message,
        ].find((msg) => typeof msg === "string") || "";
      if (reasonText.toLowerCase().includes("circuit breaker")) {
        const owner = signer.address;
        const stats = window.dashboardState.poolStats?.[addr] || {};
        let exchangeRate = stats.exchangeRate;
        if (
          !exchangeRate ||
          typeof exchangeRate !== 'bigint' ||
          exchangeRate === 0n
        ) {
          try {
            exchangeRate = await c.callStatic.exchangeRateCurrent();
          } catch (rateErr) {
            console.warn(
              "Failed to fetch exchange rate for fallback redeem",
              rateErr,
            );
            throw primaryErr;
          }
        }
        const mantissa = 1000000000000000000n;
        let redeemTokens = amt * mantissa / exchangeRate;
        if (redeemTokens === 0n) {
          redeemTokens = 1n;
        }
        const balance = await c.balanceOf(owner);
        if (redeemTokens > balance) {
          redeemTokens = balance;
        }
        if (redeemTokens === 0n) throw primaryErr;
        await (await c.redeem(redeemTokens)).wait();
        setStatus("✅ Withdraw done (fallback)");
      } else {
        throw primaryErr;
      }
    }
    loadPoolData();
  } catch (e) {
    const message =
      e?.reason || e?.error?.data?.message || e?.message || "Withdraw failed";
    setStatus("❌ " + message);
  }
}
async function updatePool(addr) {
  setStatus("⏳ Updating pool...");
  try {
    const c = new ethers.Contract(
      addr,
      ["function accrueInterest() returns (uint256)"],
      signer,
    );
    await (await c.accrueInterest()).wait();
    setStatus("✅ Pool updated");
    await loadPoolData();
  } catch (e) {
    setStatus("❌ " + (e.reason || e.message));
  }
}
async function fetchTokenPricesUSD() {
  const symbols = [
    ...new Set(pools.filter((p) => p.priceSymbol).map((p) => p.priceSymbol)),
  ];
  if (!symbols.length) {
    window.dashboardState.tokenPricesUSD = {};
    return;
  }
  const prices = { ...(window.dashboardState.tokenPricesUSD || {}) };
  const coingeckoIds = {
    ETHUSDT: "ethereum",
    BTCUSDT: "bitcoin",
    LINKUSDT: "chainlink",
  };
  for (const symbol of symbols) {
    let resolved = null;
    // Primary source: Binance
    try {
      const resp = await fetch(
        `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`,
      );
      if (resp.ok) {
        const data = await resp.json();
        const parsed = parseFloat(data.price);
        if (!Number.isNaN(parsed) && parsed > 0) {
          resolved = parsed;
        }
      } else {
        console.warn(`Binance price ${symbol} responded with ${resp.status}`);
      }
    } catch (err) {
      console.warn(`Binance price fetch failed for ${symbol}`, err);
    }

    if (resolved === null && coingeckoIds[symbol]) {
      try {
        const id = coingeckoIds[symbol];
        const resp = await fetch(
          `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`,
        );
        if (resp.ok) {
          const data = await resp.json();
          const parsed = data?.[id]?.usd;
          if (typeof parsed === "number" && parsed > 0) {
            resolved = parsed;
          }
        } else {
          console.warn(
            `Coingecko price ${symbol} responded with ${resp.status}`,
          );
        }
      } catch (err) {
        console.warn(`Coingecko price fetch failed for ${symbol}`, err);
      }
    }

    if (resolved !== null) {
      prices[symbol] = resolved;
    } else if (!(symbol in prices)) {
      console.warn(
        `Price unavailable for ${symbol}, keeping previous value if any.`,
      );
    }
  }
  window.dashboardState.tokenPricesUSD = prices;
}
async function fetchLiquidationIncentive() {
  const { value } = await tryContractCall(
    COMPTROLLER_ADDRESS,
    ["function liquidationIncentiveMantissa() view returns (uint256)"],
    (contract) => contract.liquidationIncentiveMantissa(),
    "liquidationIncentive",
  );
  return Number(value) / 1e18;
}
async function getAssetsIn(address) {
  const { value } = await tryContractCall(
    COMPTROLLER_ADDRESS,
    ["function getAssetsIn(address) view returns (address[])"],
    (contract) => contract.getAssetsIn(address),
    "getAssetsIn",
  );
  return value;
}
async function enableCollateral(addr) {
  if (!signer) return setStatus("❌ Connect wallet first");
  setStatus("⏳ Enabling collateral...");
  try {
    const comptroller = new ethers.Contract(
      COMPTROLLER_ADDRESS,
      ["function enterMarkets(address[]) returns (uint256[])"],
      signer,
    );
    await (await comptroller.enterMarkets([addr])).wait();
    setStatus("✅ Collateral enabled");
    loadPoolData();
  } catch (e) {
    setStatus("❌ " + (e.reason || e.message));
  }
}
async function fetchCollateralFactor(ctokenAddress) {
  const { value: market } = await tryContractCall(
    COMPTROLLER_ADDRESS,
    ["function markets(address) view returns (bool, uint256, bool)"],
    (contract) => contract.markets(ctokenAddress),
    `markets(${ctokenAddress})`,
  );
  return Number(market[1]) / 1e18;
}
async function fetchBorrowLimit(userAddress) {
  const { value } = await tryContractCall(
    COMPTROLLER_ADDRESS,
    [
      "function getAccountLiquidity(address) view returns (uint256, uint256, uint256)",
    ],
    (contract) => contract.getAccountLiquidity(userAddress),
    "getAccountLiquidity",
  );
  const [error, liquidity, shortfall] = value;
  if (error !== 0n) return 0;
  // liquidity обычно в 1e18, это и есть borrow limit в USD
  return Number(ethers.formatUnits(liquidity, 18));
}

// Получить collateralFactor для всех пулов
async function updateAllCollateralFactors() {
  for (const p of pools) {
    try {
      p.collateralFactor = await fetchCollateralFactor(p.address);
    } catch (err) {
      console.warn(`Failed to fetch collateral factor for ${p.name}`, err);
      p.collateralFactor = p.collateralFactor || 0;
    }
  }
}
