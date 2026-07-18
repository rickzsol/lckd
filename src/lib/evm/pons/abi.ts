import { parseAbi } from "viem";

export const PONS_FACTORY_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function locker() view returns (address)",
  "function launchFee() view returns (uint256)",
  "function launchEnabled() view returns (bool)",
  "function getDexConfig(uint256 id) view returns ((string name,address factory,address positionManager,address swapRouter,uint24 poolFee,int24 tickSpacing,bool enabled))",
  "function getLaunchConfig(uint256 id) view returns ((address pairToken,uint256 graduationThreshold,int24 initialTick,uint256 supply,uint16 maxWalletBps,uint16 maxTxBps,uint32 restrictionBlocks,uint24 reservedFee,bool enabled,bool routerRequiresDeadline))",
  "function getLaunchedToken(address token) view returns ((address token,address deployer,address pairedToken,address positionManager,uint256 positionId,uint256 dexId,uint256 launchConfigId,uint256 restrictionsEndBlock,uint256 supply,bool isToken0,uint24 poolFee,bool exists,uint256 initialBuyAmount))",
  "function launchToken((string name,string symbol,string logo,string description,(string twitter,string telegram,string discord,string website,string farcaster) socials,address feeWallet) params,uint256 launchConfigId,uint256 dexId,bytes32 salt) payable returns (address token)",
  "event TokenDeployed(address indexed token,address indexed deployer,address indexed dexFactory,address pairToken,uint256 dexId,uint256 launchConfigId)",
  "event TokenLaunched(address indexed token,address indexed deployer,address indexed dexFactory,address pairToken,address pool,uint256 dexId,uint256 launchConfigId,uint256 positionId,uint256 restrictionsEndBlock,uint256 initialBuyAmount)",
]);

export const PONS_LOCKER_ABI = parseAbi([
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function factory() view returns (address)",
  "function protocolFeeRecipient() view returns (address)",
  "function protocolFeeShare() view returns (uint256)",
  "function tokenProtocolFeeShares(address token) view returns (uint256)",
  "function feeRedirects(address token) view returns (address)",
  "event PositionLocked(address indexed token,address indexed deployer,uint256 indexed dexId,address pairedToken,uint256 positionId,address positionManager)",
]);

export const PONS_TOKEN_ABI = parseAbi([
  "function totalSupply() view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address account) view returns (uint256)",
  "function deployer() view returns (address)",
  "function launchFactory() view returns (address)",
  "function positionManager() view returns (address)",
  "function pairToken() view returns (address)",
  "function poolFee() view returns (uint24)",
  "function restrictionEndBlock() view returns (uint256)",
  "function liquidityPool() view returns (address)",
]);

export const PONS_POSITION_MANAGER_ABI = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getApproved(uint256 tokenId) view returns (address)",
  "function isApprovedForAll(address owner,address operator) view returns (bool)",
  "function safeTransferFrom(address from,address to,uint256 tokenId)",
]);
