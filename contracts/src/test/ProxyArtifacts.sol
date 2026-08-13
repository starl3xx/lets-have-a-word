// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// Pulls ERC1967Proxy into the artifact set so deployment scripts can construct
// a proxy directly instead of going through upgrades.deployProxy.
//
// That matters on RPCs where the plugin's immediate post-deploy read of the
// ERC-1967 implementation slot returns empty and it wrongly reports
// "doesn't look like an ERC 1967 proxy" — the proxy deploys fine, the plugin
// just cannot see it yet. Deploying the proxy explicitly and registering it
// with forceImport afterwards is deterministic and leaves the manifest correct.
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
