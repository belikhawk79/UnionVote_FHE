pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract UnionVote_FHE is ZamaEthereumConfig {
    struct EncryptedVote {
        euint32 encryptedVote;      // Encrypted vote value
        address voter;              // Voter address
        uint256 timestamp;          // Voting timestamp
        bool revealed;              // Flag for vote revelation
        uint32 decryptedVote;       // Decrypted vote value
    }

    struct VotingSession {
        string issueId;             // Unique identifier for the voting issue
        uint256 startTime;          // Voting session start time
        uint256 endTime;            // Voting session end time
        uint32 totalVotes;          // Total number of votes cast
        uint32 yesCount;            // Count of "yes" votes
        uint32 noCount;             // Count of "no" votes
        bool isActive;              // Flag for active voting session
        bool resultsCalculated;     // Flag for calculated results
    }

    mapping(string => VotingSession) public votingSessions;
    mapping(string => EncryptedVote[]) public encryptedVotes;
    mapping(address => mapping(string => bool)) public hasVoted;

    string[] public issueIds;

    event VotingSessionCreated(string indexed issueId, uint256 startTime, uint256 endTime);
    event VoteCast(string indexed issueId, address indexed voter);
    event VoteRevealed(string indexed issueId, address indexed voter, uint32 decryptedVote);
    event ResultsCalculated(string indexed issueId, uint32 yesCount, uint32 noCount);

    constructor() ZamaEthereumConfig() {
    }

    function createVotingSession(
        string calldata issueId,
        uint256 startTime,
        uint256 endTime
    ) external {
        require(bytes(votingSessions[issueId].issueId).length == 0, "Voting session already exists");
        require(startTime < endTime, "Invalid time range");
        require(block.timestamp < endTime, "End time must be in the future");

        votingSessions[issueId] = VotingSession({
            issueId: issueId,
            startTime: startTime,
            endTime: endTime,
            totalVotes: 0,
            yesCount: 0,
            noCount: 0,
            isActive: true,
            resultsCalculated: false
        });

        issueIds.push(issueId);

        emit VotingSessionCreated(issueId, startTime, endTime);
    }

    function castVote(
        string calldata issueId,
        externalEuint32 encryptedVote,
        bytes calldata inputProof
    ) external {
        require(bytes(votingSessions[issueId].issueId).length > 0, "Voting session does not exist");
        require(votingSessions[issueId].isActive, "Voting session is not active");
        require(block.timestamp >= votingSessions[issueId].startTime, "Voting has not started");
        require(block.timestamp <= votingSessions[issueId].endTime, "Voting has ended");
        require(!hasVoted[msg.sender][issueId], "Already voted");

        require(FHE.isInitialized(FHE.fromExternal(encryptedVote, inputProof)), "Invalid encrypted vote");

        encryptedVotes[issueId].push(EncryptedVote({
            encryptedVote: FHE.fromExternal(encryptedVote, inputProof),
            voter: msg.sender,
            timestamp: block.timestamp,
            revealed: false,
            decryptedVote: 0
        }));

        FHE.allowThis(encryptedVotes[issueId][encryptedVotes[issueId].length - 1].encryptedVote);
        FHE.makePubliclyDecryptable(encryptedVotes[issueId][encryptedVotes[issueId].length - 1].encryptedVote);

        hasVoted[msg.sender][issueId] = true;
        votingSessions[issueId].totalVotes++;

        emit VoteCast(issueId, msg.sender);
    }

    function revealVote(
        string calldata issueId,
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(votingSessions[issueId].issueId).length > 0, "Voting session does not exist");
        require(block.timestamp > votingSessions[issueId].endTime, "Voting is still in progress");
        require(!votingSessions[issueId].resultsCalculated, "Results already calculated");

        uint256 voteIndex = encryptedVotes[issueId].length;
        for (uint256 i = 0; i < encryptedVotes[issueId].length; i++) {
            if (encryptedVotes[issueId][i].voter == msg.sender && !encryptedVotes[issueId][i].revealed) {
                voteIndex = i;
                break;
            }
        }
        require(voteIndex < encryptedVotes[issueId].length, "No vote found for this address");

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(encryptedVotes[issueId][voteIndex].encryptedVote);

        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);

        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        require(decodedValue == 1 || decodedValue == 0, "Invalid vote value");

        encryptedVotes[issueId][voteIndex].decryptedVote = decodedValue;
        encryptedVotes[issueId][voteIndex].revealed = true;

        emit VoteRevealed(issueId, msg.sender, decodedValue);
    }

    function calculateResults(string calldata issueId) external {
        require(bytes(votingSessions[issueId].issueId).length > 0, "Voting session does not exist");
        require(block.timestamp > votingSessions[issueId].endTime, "Voting is still in progress");
        require(!votingSessions[issueId].resultsCalculated, "Results already calculated");

        for (uint256 i = 0; i < encryptedVotes[issueId].length; i++) {
            require(encryptedVotes[issueId][i].revealed, "Some votes are not revealed");
            if (encryptedVotes[issueId][i].decryptedVote == 1) {
                votingSessions[issueId].yesCount++;
            } else {
                votingSessions[issueId].noCount++;
            }
        }

        votingSessions[issueId].resultsCalculated = true;
        votingSessions[issueId].isActive = false;

        emit ResultsCalculated(issueId, votingSessions[issueId].yesCount, votingSessions[issueId].noCount);
    }

    function getVote(string calldata issueId, uint256 index) external view returns (
        euint32 encryptedVote,
        address voter,
        uint256 timestamp,
        bool revealed,
        uint32 decryptedVote
    ) {
        require(bytes(votingSessions[issueId].issueId).length > 0, "Voting session does not exist");
        require(index < encryptedVotes[issueId].length, "Invalid vote index");

        EncryptedVote storage vote = encryptedVotes[issueId][index];
        return (
            vote.encryptedVote,
            vote.voter,
            vote.timestamp,
            vote.revealed,
            vote.decryptedVote
        );
    }

    function getVotingSession(string calldata issueId) external view returns (
        uint256 startTime,
        uint256 endTime,
        uint32 totalVotes,
        uint32 yesCount,
        uint32 noCount,
        bool isActive,
        bool resultsCalculated
    ) {
        require(bytes(votingSessions[issueId].issueId).length > 0, "Voting session does not exist");
        VotingSession storage session = votingSessions[issueId];
        return (
            session.startTime,
            session.endTime,
            session.totalVotes,
            session.yesCount,
            session.noCount,
            session.isActive,
            session.resultsCalculated
        );
    }

    function getAllIssueIds() external view returns (string[] memory) {
        return issueIds;
    }

    function isAvailable() public pure returns (bool) {
        return true;
    }
}


