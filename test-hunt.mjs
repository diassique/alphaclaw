/**
 * Test: buy a hunt from AlphaClaw coordinator via x402
 * Wallet 2 (AlphaClaw agent) pays $0.05 to Wallet 1 (coordinator receiver)
 * Then coordinator pays $0.039 to 5 sub-agents
 */

import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem'
import { baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { createPaymentHeader, selectPaymentRequirements } from 'x402/client'
import { readFileSync } from 'fs'

const COORDINATOR_URL = 'http://localhost:5000'
const TOPIC = 'Trump impeachment 2026'

// Load AlphaClaw wallet
const creds = JSON.parse(readFileSync('/root/.config/alphaclaw/wallet.json', 'utf8'))
const account = privateKeyToAccount(creds.privateKey)
const walletClient = createWalletClient({
  account,
  chain: baseSepolia,
  transport: http('https://sepolia.base.org')
})
const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http('https://sepolia.base.org')
})

// Check USDC balance before
const USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e'
const ERC20_ABI = [{ name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'account', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] }]

const balBefore = await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })
console.log(`\n🐾 AlphaClaw Test Transaction`)
console.log(`Wallet: ${account.address}`)
console.log(`USDC balance before: ${formatUnits(balBefore, 6)} USDC`)
console.log(`\nBuying hunt for topic: "${TOPIC}"`)
console.log('─'.repeat(60))

// Step 1: hit the endpoint to get 402
const res1 = await fetch(`${COORDINATOR_URL}/hunt`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ topic: TOPIC })
})

if (res1.status !== 402) {
  console.log('Expected 402, got:', res1.status)
  process.exit(1)
}

const body = await res1.json()
console.log(`\n📋 Payment required: $${parseInt(body.accepts[0].maxAmountRequired) / 1_000_000} USDC`)
console.log(`   Pay to: ${body.accepts[0].payTo}`)
console.log(`   Asset:  ${body.accepts[0].asset}`)

// Step 2: create payment header and retry
console.log(`\n💳 Signing x402 payment...`)
const selected = selectPaymentRequirements(body.accepts)
const paymentHeader = await createPaymentHeader(walletClient, body.x402Version ?? 1, selected)

console.log(`✅ Payment header created`)
console.log(`\n🚀 Sending paid request to coordinator...`)
const t0 = Date.now()

const res2 = await fetch(`${COORDINATOR_URL}/hunt`, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-PAYMENT': paymentHeader,
    'Access-Control-Expose-Headers': 'X-PAYMENT-RESPONSE'
  },
  body: JSON.stringify({ topic: TOPIC })
})

const elapsed = Date.now() - t0
const data = await res2.json()

console.log(`\n${'═'.repeat(60)}`)
console.log(`STATUS: ${res2.status} | Time: ${elapsed}ms`)
console.log(`${'═'.repeat(60)}`)

if (data.alpha) {
  console.log(`\n📊 ALPHA REPORT`)
  console.log(`Topic:          ${data.topic}`)
  console.log(`Recommendation: ${data.alpha.recommendation}`)
  console.log(`Confidence:     ${data.alpha.confidence}`)
  console.log(`Signals:        ${data.alpha.signals.join(', ')}`)

  console.log(`\n💸 PAYMENT BREAKDOWN (coordinator paid sub-agents):`)
  for (const p of data.agentPayments.breakdown) {
    const status = p.paid ? '✅ PAID' : '⚠️  demo'
    const tx = p.txHash ? `\n     tx: ${p.txHash}` : ''
    console.log(`  ${status} | ${p.service.padEnd(35)} ${p.price}${tx}`)
  }
  console.log(`\n  Total sub-agent cost: ${data.agentPayments.totalPaid}`)

  if (data.cachedReport) {
    console.log(`\n📦 Report cached: ${data.cachedReport.id}`)
    console.log(`   Buy at: ${data.cachedReport.availableAt} for ${data.cachedReport.price}`)
  }

  if (data.economicCycle) {
    console.log(`\n💰 ECONOMIC CYCLE:`)
    console.log(`   Bought:  ${data.economicCycle.bought}`)
    console.log(`   Sold:    ${data.economicCycle.sold}`)
    console.log(`   Margin:  ${data.economicCycle.margin}`)
  }
} else {
  console.log(JSON.stringify(data, null, 2))
}

// Balance after
await new Promise(r => setTimeout(r, 3000))
const balAfter = await publicClient.readContract({ address: USDC, abi: ERC20_ABI, functionName: 'balanceOf', args: [account.address] })
console.log(`\n${'─'.repeat(60)}`)
console.log(`USDC before: ${formatUnits(balBefore, 6)}`)
console.log(`USDC after:  ${formatUnits(balAfter, 6)}`)
console.log(`Spent:       ${formatUnits(balBefore - balAfter, 6)} USDC`)
console.log(`${'─'.repeat(60)}`)
