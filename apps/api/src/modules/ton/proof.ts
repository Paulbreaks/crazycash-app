import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import {
  Address,
  Cell,
  contractAddress,
  domainSignVerify,
  loadStateInit,
  WalletContractV4,
  WalletContractV5R1,
} from '@ton/ton';
import { sha256 } from '@ton/crypto';
import { prisma } from '../../plugins/prisma.js';
import { env } from '../../plugins/env.js';
import { uuidv7 } from '../../lib/uuid.js';
import type { CurrentUser } from '../auth/session.js';

const TON_PROOF_PREFIX = 'ton-proof-item-v2/';
const TON_CONNECT_PREFIX = 'ton-connect';
const TON_PROOF_SIGNATURE_BYTES = 64;

export class TonProofUnavailableForGuestError extends Error {}
export class TonProofWrongNetworkError extends Error {}
export class TonProofUnsupportedWalletError extends Error {}
export class TonProofInvalidError extends Error {}
export class TonProofChallengeError extends Error {}
export class TonWalletAlreadyLinkedError extends Error {}

const UnixTimestampSchema = z.union([
  z.string().regex(/^\d{1,16}$/),
  z.number().int().nonnegative().safe(),
]).transform((value) => BigInt(value));

const TonProofVerifyBodySchema = z.object({
  address: z.string().min(1).max(128),
  network: z.enum(['-3', '-239']),
  public_key: z.string().regex(/^[0-9a-fA-F]{64}$/).optional(),
  proof: z.object({
    timestamp: UnixTimestampSchema,
    domain: z.object({
      lengthBytes: z.number().int().min(1).max(128),
      value: z.string().min(1).max(128),
    }),
    payload: z.string().regex(/^[0-9a-f]{64}$/i),
    signature: z.string().min(1).max(256),
    state_init: z.string().min(1).max(16_384),
  }).strict(),
}).strict();

type TonProofVerifyBody = z.infer<typeof TonProofVerifyBodySchema>;

export type TonWalletView = {
  verified: boolean;
  network: 'testnet' | 'mainnet';
  address: string;
  verifiedAt: string;
};

function configuredNetwork(): 'testnet' | 'mainnet' {
  return env.TON_NETWORK;
}

function networkChainId(network: 'testnet' | 'mainnet'): '-3' | '-239' {
  return network === 'testnet' ? '-3' : '-239';
}

function expectedDomain(): string {
  return env.TON_PROOF_DOMAIN;
}

function publicKeyFromWalletV4(stateInitData: Cell): Buffer {
  // Wallet V4 data is: seqno:uint32, wallet_id:uint32, public_key:uint256,
  // plugins:(HashmapE 267). We deliberately support only this reviewed layout.
  const slice = stateInitData.beginParse();
  if (slice.remainingBits < 320) throw new TonProofInvalidError();
  slice.skip(32);
  slice.skip(32);
  return slice.loadBuffer(32);
}

function publicKeyFromWalletV5R1(stateInitData: Cell): Buffer {
  // Wallet V5R1 data is: is_signature_allowed:bool, seqno:uint32,
  // wallet_id:int32, public_key:uint256, plugins:(HashmapE 256). This layout
  // is accepted only after its exact code hash matched our fixed allowlist.
  const slice = stateInitData.beginParse();
  if (slice.remainingBits < 321) throw new TonProofInvalidError();
  slice.skip(1);
  slice.skip(32);
  slice.skip(32);
  return slice.loadBuffer(32);
}

function getWalletV4CodeHash(): string {
  return WalletContractV4.create({ workchain: 0, publicKey: Buffer.alloc(32) })
    .init.code.hash().toString('hex');
}

function getWalletV5R1CodeHash(): string {
  // The code cell is invariant across public keys, wallet IDs and networks.
  // Those values live in StateInit data and remain covered by the independent
  // contract-address derivation below.
  return WalletContractV5R1.create({ workchain: 0, publicKey: Buffer.alloc(32) })
    .init.code.hash().toString('hex');
}

// Do not accept a browser-provided key based solely on a claimed wallet type.
// Only these reviewed standard-wallet code hashes may select a parser.
const WALLET_V4_CODE_HASH = getWalletV4CodeHash();
const WALLET_V5R1_CODE_HASH = getWalletV5R1CodeHash();

function publicKeyFromSupportedWallet(stateInit: ReturnType<typeof loadStateInit>): Buffer {
  if (!stateInit.code || !stateInit.data) throw new TonProofUnsupportedWalletError();

  const codeHash = stateInit.code.hash().toString('hex');
  if (codeHash === WALLET_V4_CODE_HASH) return publicKeyFromWalletV4(stateInit.data);
  if (codeHash === WALLET_V5R1_CODE_HASH) return publicKeyFromWalletV5R1(stateInit.data);
  throw new TonProofUnsupportedWalletError();
}

function toWalletView(wallet: {
  rawAddress: string;
  network: 'testnet' | 'mainnet';
  verifiedAt: Date;
}): TonWalletView {
  const address = Address.parseRaw(wallet.rawAddress);
  return {
    verified: true,
    network: wallet.network,
    // User-friendly string is for display only. The database uses raw address.
    address: address.toString({ urlSafe: true, bounceable: false, testOnly: wallet.network === 'testnet' }),
    verifiedAt: wallet.verifiedAt.toISOString(),
  };
}

async function verifyCryptographicProof(body: TonProofVerifyBody): Promise<{ rawAddress: string; publicKey: string }> {
  if (body.network !== networkChainId(configuredNetwork())) throw new TonProofWrongNetworkError();
  if (body.proof.domain.value !== expectedDomain()) throw new TonProofInvalidError();

  const domainBytes = Buffer.from(body.proof.domain.value, 'utf8');
  if (domainBytes.length !== body.proof.domain.lengthBytes) throw new TonProofInvalidError();

  const now = BigInt(Math.floor(Date.now() / 1_000));
  const maximumAge = BigInt(env.TON_PROOF_MAX_AGE_SECONDS);
  if (body.proof.timestamp > now + 30n || now - body.proof.timestamp > maximumAge) {
    throw new TonProofInvalidError();
  }

  let wantedAddress: Address;
  let stateInit: ReturnType<typeof loadStateInit>;
  try {
    wantedAddress = Address.parse(body.address);
    stateInit = loadStateInit(Cell.fromBase64(body.proof.state_init).beginParse());
  } catch {
    throw new TonProofInvalidError();
  }

  const derivedAddress = contractAddress(wantedAddress.workChain, stateInit);
  if (!derivedAddress.equals(wantedAddress)) throw new TonProofInvalidError();

  const publicKey = publicKeyFromSupportedWallet(stateInit);
  if (body.public_key && !publicKey.equals(Buffer.from(body.public_key, 'hex'))) {
    throw new TonProofInvalidError();
  }

  let signature: Buffer;
  try {
    signature = Buffer.from(body.proof.signature, 'base64');
  } catch {
    throw new TonProofInvalidError();
  }
  if (signature.length !== TON_PROOF_SIGNATURE_BYTES) throw new TonProofInvalidError();

  const workchain = Buffer.alloc(4);
  workchain.writeInt32BE(wantedAddress.workChain, 0);
  const domainLength = Buffer.alloc(4);
  domainLength.writeUInt32LE(body.proof.domain.lengthBytes, 0);
  const timestamp = Buffer.alloc(8);
  timestamp.writeBigUInt64LE(body.proof.timestamp, 0);

  const message = Buffer.concat([
    Buffer.from(TON_PROOF_PREFIX),
    workchain,
    wantedAddress.hash,
    domainLength,
    domainBytes,
    timestamp,
    Buffer.from(body.proof.payload, 'utf8'),
  ]);
  const proofHash = Buffer.from(await sha256(message));
  const signatureData = Buffer.from(await sha256(Buffer.concat([
    Buffer.from([0xff, 0xff]),
    Buffer.from(TON_CONNECT_PREFIX),
    proofHash,
  ])));

  if (!domainSignVerify({ data: signatureData, signature, publicKey, domain: { type: 'empty' } })) {
    throw new TonProofInvalidError();
  }

  return { rawAddress: wantedAddress.toRawString(), publicKey: publicKey.toString('hex') };
}

/** Issue a unique challenge bound to the current opaque-cookie session. */
export async function issueTonProofChallenge(session: { id: bigint; user: CurrentUser }) {
  if (session.user.accountType !== 'telegram') throw new TonProofUnavailableForGuestError();

  const now = new Date();
  const expiresAt = new Date(now.getTime() + env.TON_PROOF_CHALLENGE_TTL_SECONDS * 1_000);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const payload = randomBytes(32).toString('hex');
    try {
      await prisma.tonProofChallenge.create({
        data: { payload, sessionId: session.id, userId: session.user.id, expiresAt },
      });
      return { payload, expiresAt: expiresAt.toISOString(), network: configuredNetwork() };
    } catch (error) {
      // A 256-bit random payload collision is implausible, but a bounded retry
      // turns the DB uniqueness constraint into the final safety boundary.
      if (attempt === 2) throw error;
    }
  }
  throw new Error('Unable to issue TON proof challenge');
}

/** Verify proof first, then atomically consume its single-use challenge. */
export async function verifyAndLinkTonWallet(
  session: { id: bigint; user: CurrentUser },
  rawBody: unknown,
): Promise<TonWalletView> {
  if (session.user.accountType !== 'telegram') throw new TonProofUnavailableForGuestError();
  const parsed = TonProofVerifyBodySchema.safeParse(rawBody);
  if (!parsed.success) throw new TonProofInvalidError();
  const body = parsed.data;
  const verified = await verifyCryptographicProof(body);
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const consumed = await tx.tonProofChallenge.updateMany({
      where: {
        payload: body.proof.payload,
        sessionId: session.id,
        userId: session.user.id,
        consumedAt: null,
        expiresAt: { gt: now },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) throw new TonProofChallengeError();

    const existingByAddress = await tx.wallet.findUnique({ where: { rawAddress: verified.rawAddress } });
    if (existingByAddress && existingByAddress.userId !== session.user.id) {
      throw new TonWalletAlreadyLinkedError();
    }

    const wallet = await tx.wallet.upsert({
      where: { userId_network: { userId: session.user.id, network: configuredNetwork() } },
      update: {
        rawAddress: verified.rawAddress,
        publicKey: verified.publicKey,
        verifiedAt: now,
        disconnectedAt: null,
      },
      create: {
        uuid: uuidv7(),
        userId: session.user.id,
        rawAddress: verified.rawAddress,
        publicKey: verified.publicKey,
        network: configuredNetwork(),
        verifiedAt: now,
      },
    });
    return toWalletView(wallet);
  });
}

export async function getTonWalletCapability(user: CurrentUser): Promise<TonWalletView | null> {
  if (user.accountType !== 'telegram') return null;
  const wallet = await prisma.wallet.findUnique({
    where: { userId_network: { userId: user.id, network: configuredNetwork() } },
  });
  return wallet && wallet.disconnectedAt === null ? toWalletView(wallet) : null;
}

export async function disconnectTonWallet(user: CurrentUser): Promise<void> {
  if (user.accountType !== 'telegram') throw new TonProofUnavailableForGuestError();
  await prisma.wallet.updateMany({
    where: { userId: user.id, network: configuredNetwork(), disconnectedAt: null },
    data: { disconnectedAt: new Date() },
  });
}
