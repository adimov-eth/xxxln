In a production setting, you’ll typically have more dynamic peer connectivity: nodes can appear and disappear at any time, and you can’t just wait until “everyone is connected.” Instead, each node is constantly discovering peers, syncing state, and deciding when to propose a block based on consensus rules. Here’s how the concept translates to a real-world scenario:

1. Nodes keep a target peer count (e.g., “at least N peers”).
2. As they find peers, they begin syncing. Block production starts or continues so long as a quorum of peers has caught up.
3. If a node is brand new and has zero peers, it usually waits to discover some peers (or reconnect) and fetch the chain. But others who already have a healthy peer set will keep proposing blocks in the meantime.
4. A consensus mechanism (PoS/PoW/BFT) ensures that the chain remains consistent event if some nodes come and go; you don’t rely on one node’s local “wait” logic.

In short, “waiting for all peers” is mostly relevant in small local test networks. In production, the network never fully “waits.” Instead, each node is separately responsible for learning about the chain, verifying blocks, and producing new blocks if it’s a validator. Over time, all correct/fault-free validator nodes converge on the same chain height—even if some peers are offline or unknown to them.