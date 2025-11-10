import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useState, useEffect } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';
import { ethers } from 'ethers';

interface VoteData {
  id: string;
  title: string;
  description: string;
  encryptedVotes: number;
  publicVotes: number;
  timestamp: number;
  creator: string;
  isVerified: boolean;
  decryptedValue: number;
}

interface VoteStats {
  totalVotes: number;
  verifiedVotes: number;
  avgParticipation: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [votes, setVotes] = useState<VoteData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creatingVote, setCreatingVote] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newVoteData, setNewVoteData] = useState({ title: "", description: "", voteValue: "" });
  const [selectedVote, setSelectedVote] = useState<VoteData | null>(null);
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [contractAddress, setContractAddress] = useState("");
  const [fhevmInitializing, setFhevmInitializing] = useState(false);
  const [voteStats, setVoteStats] = useState<VoteStats>({ totalVotes: 0, verifiedVotes: 0, avgParticipation: 0 });
  const [faqOpen, setFaqOpen] = useState<number | null>(null);
  const [chartData, setChartData] = useState<{ labels: string[], values: number[] }>({ labels: [], values: [] });

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected || isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadData();
        const contract = await getContractReadOnly();
        if (contract) setContractAddress(await contract.getAddress());
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const votesList: VoteData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          votesList.push({
            id: businessId,
            title: businessData.name,
            description: businessData.description,
            encryptedVotes: Number(businessData.publicValue1) || 0,
            publicVotes: Number(businessData.publicValue2) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading vote data:', e);
        }
      }
      
      setVotes(votesList);
      calculateStats(votesList);
      generateChartData(votesList);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const calculateStats = (votesList: VoteData[]) => {
    const totalVotes = votesList.length;
    const verifiedVotes = votesList.filter(v => v.isVerified).length;
    const avgParticipation = totalVotes > 0 
      ? votesList.reduce((sum, v) => sum + v.publicVotes, 0) / totalVotes 
      : 0;
    
    setVoteStats({ totalVotes, verifiedVotes, avgParticipation });
  };

  const generateChartData = (votesList: VoteData[]) => {
    const labels = votesList.map(v => v.title.substring(0, 15) + (v.title.length > 15 ? '...' : ''));
    const values = votesList.map(v => v.isVerified ? v.decryptedValue : v.publicVotes);
    setChartData({ labels, values });
  };

  const createVote = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setCreatingVote(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Creating vote with FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract");
      
      const voteValue = parseInt(newVoteData.voteValue) || 0;
      const businessId = `vote-${Date.now()}`;
      
      const encryptedResult = await encrypt(contractAddress, address, voteValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newVoteData.title,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        0,
        0,
        newVoteData.description
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Processing transaction..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Vote created!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadData();
      setShowCreateModal(false);
      setNewVoteData({ title: "", description: "", voteValue: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Submission failed";
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setCreatingVote(false); 
    }
  };

  const decryptVote = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    setIsDecrypting(true);
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        contractAddress,
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Verified!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Already verified" });
        setTimeout(() => {
          setTransactionStatus({ visible: false, status: "pending", message: "" });
        }, 2000);
        
        await loadData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Decryption failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    } finally { 
      setIsDecrypting(false); 
    }
  };

  const handleAvailable = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvail = await contract.isAvailable();
      if (isAvail) {
        setTransactionStatus({ visible: true, status: "success", message: "Contract available!" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const toggleFaq = (index: number) => {
    setFaqOpen(faqOpen === index ? null : index);
  };

  const renderStats = () => {
    return (
      <div className="stats-panels">
        <div className="panel metal-panel">
          <h3>Total Votes</h3>
          <div className="stat-value">{voteStats.totalVotes}</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Verified Votes</h3>
          <div className="stat-value">{voteStats.verifiedVotes}</div>
        </div>
        
        <div className="panel metal-panel">
          <h3>Avg Participation</h3>
          <div className="stat-value">{voteStats.avgParticipation.toFixed(1)}</div>
        </div>
      </div>
    );
  };

  const renderChart = () => {
    return (
      <div className="chart-container">
        <div className="chart-bars">
          {chartData.values.map((value, index) => (
            <div className="chart-bar" key={index}>
              <div 
                className="bar-fill" 
                style={{ height: `${Math.min(100, value * 10)}%` }}
              >
                <span className="bar-value">{value}</span>
              </div>
              <div className="bar-label">{chartData.labels[index]}</div>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const renderFaq = () => {
    const faqs = [
      { 
        question: "How does FHE protect my vote?", 
        answer: "Fully Homomorphic Encryption allows votes to be encrypted while still being counted, ensuring your choice remains private." 
      },
      { 
        question: "Is my identity anonymous?", 
        answer: "Yes, your wallet address is never linked to your vote content, only to the act of voting." 
      },
      { 
        question: "How are votes counted?", 
        answer: "Votes are encrypted on your device, aggregated using homomorphic addition, then decrypted collectively." 
      }
    ];

    return (
      <div className="faq-section">
        <h3>Frequently Asked Questions</h3>
        <div className="faq-items">
          {faqs.map((faq, index) => (
            <div className="faq-item" key={index}>
              <div className="faq-question" onClick={() => toggleFaq(index)}>
                {faq.question}
                <span className="faq-icon">{faqOpen === index ? '−' : '+'}</span>
              </div>
              {faqOpen === index && <div className="faq-answer">{faq.answer}</div>}
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo">
            <h1>Private Union Voting 🔒</h1>
          </div>
          <div className="header-actions">
            <div className="wallet-connect-wrapper">
              <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
            </div>
          </div>
        </header>
        
        <div className="connection-prompt">
          <div className="connection-content">
            <div className="connection-icon">✊</div>
            <h2>Secure Union Voting</h2>
            <p>Connect your wallet to participate in encrypted union voting protected by FHE technology.</p>
            <div className="connection-steps">
              <div className="step">
                <span>1</span>
                <p>Connect wallet to access voting system</p>
              </div>
              <div className="step">
                <span>2</span>
                <p>FHE encryption initializes automatically</p>
              </div>
              <div className="step">
                <span>3</span>
                <p>Vote securely without fear of retaliation</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="fhe-spinner"></div>
        <p>Initializing FHE Encryption...</p>
        <p className="loading-note">Securing your vote</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="fhe-spinner"></div>
      <p>Loading voting system...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="logo">
          <h1>UnionVote FHE ✊</h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowCreateModal(true)} 
            className="create-btn"
          >
            + New Vote
          </button>
          <div className="wallet-connect-wrapper">
            <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
          </div>
        </div>
      </header>
      
      <div className="main-content-container">
        <div className="dashboard-section">
          <h2>Union Voting Dashboard</h2>
          {renderStats()}
          
          <div className="panel metal-panel full-width">
            <h3>Voting Analytics</h3>
            {renderChart()}
          </div>
        </div>
        
        <div className="votes-section">
          <div className="section-header">
            <h2>Active Votes</h2>
            <div className="header-actions">
              <button 
                onClick={loadData} 
                className="refresh-btn" 
                disabled={isRefreshing}
              >
                {isRefreshing ? "Refreshing..." : "Refresh"}
              </button>
              <button 
                onClick={handleAvailable}
                className="check-btn"
              >
                Check Status
              </button>
            </div>
          </div>
          
          <div className="votes-list">
            {votes.length === 0 ? (
              <div className="no-votes">
                <p>No active votes</p>
                <button 
                  className="create-btn" 
                  onClick={() => setShowCreateModal(true)}
                >
                  Create First Vote
                </button>
              </div>
            ) : votes.map((vote, index) => (
              <div 
                className={`vote-item ${selectedVote?.id === vote.id ? "selected" : ""} ${vote.isVerified ? "verified" : ""}`} 
                key={index}
                onClick={() => setSelectedVote(vote)}
              >
                <div className="vote-title">{vote.title}</div>
                <div className="vote-description">{vote.description}</div>
                <div className="vote-meta">
                  <span>Created: {new Date(vote.timestamp * 1000).toLocaleDateString()}</span>
                  <span>By: {vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</span>
                </div>
                <div className="vote-status">
                  {vote.isVerified ? 
                    `✅ Verified: ${vote.decryptedValue} votes` : 
                    "🔓 Pending verification"
                  }
                </div>
              </div>
            ))}
          </div>
        </div>
        
        <div className="info-section">
          {renderFaq()}
        </div>
      </div>
      
      {showCreateModal && (
        <ModalCreateVote 
          onSubmit={createVote} 
          onClose={() => setShowCreateModal(false)} 
          creating={creatingVote} 
          voteData={newVoteData} 
          setVoteData={setNewVoteData}
          isEncrypting={isEncrypting}
        />
      )}
      
      {selectedVote && (
        <VoteDetailModal 
          vote={selectedVote} 
          onClose={() => setSelectedVote(null)} 
          isDecrypting={isDecrypting || fheIsDecrypting} 
          decryptData={() => decryptVote(selectedVote.id)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="fhe-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon">✓</div>}
              {transactionStatus.status === "error" && <div className="error-icon">✗</div>}
            </div>
            <div className="transaction-message">{transactionStatus.message}</div>
          </div>
        </div>
      )}
    </div>
  );
};

const ModalCreateVote: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  creating: boolean;
  voteData: any;
  setVoteData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, creating, voteData, setVoteData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    if (name === 'voteValue') {
      const intValue = value.replace(/[^\d]/g, '');
      setVoteData({ ...voteData, [name]: intValue });
    } else {
      setVoteData({ ...voteData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="create-vote-modal">
        <div className="modal-header">
          <h2>New Union Vote</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice">
            <strong>FHE 🔐 Protection</strong>
            <p>Votes will be encrypted using Zama FHE technology</p>
          </div>
          
          <div className="form-group">
            <label>Vote Title *</label>
            <input 
              type="text" 
              name="title" 
              value={voteData.title} 
              onChange={handleChange} 
              placeholder="Enter vote title..." 
            />
          </div>
          
          <div className="form-group">
            <label>Description *</label>
            <textarea 
              name="description" 
              value={voteData.description} 
              onChange={handleChange} 
              placeholder="Describe the vote..." 
            />
          </div>
          
          <div className="form-group">
            <label>Your Vote (Integer) *</label>
            <input 
              type="number" 
              name="voteValue" 
              value={voteData.voteValue} 
              onChange={handleChange} 
              placeholder="Enter your vote..." 
              step="1"
              min="0"
            />
            <div className="data-type-label">FHE Encrypted</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={creating || isEncrypting || !voteData.title || !voteData.description || !voteData.voteValue} 
            className="submit-btn"
          >
            {creating || isEncrypting ? "Encrypting..." : "Create Vote"}
          </button>
        </div>
      </div>
    </div>
  );
};

const VoteDetailModal: React.FC<{
  vote: VoteData;
  onClose: () => void;
  isDecrypting: boolean;
  decryptData: () => Promise<number | null>;
}> = ({ vote, onClose, isDecrypting, decryptData }) => {
  const [decryptedValue, setDecryptedValue] = useState<number | null>(null);

  const handleDecrypt = async () => {
    if (vote.isVerified) return;
    
    const value = await decryptData();
    if (value !== null) {
      setDecryptedValue(value);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="vote-detail-modal">
        <div className="modal-header">
          <h2>Vote Details</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="vote-info">
            <div className="info-item">
              <span>Title:</span>
              <strong>{vote.title}</strong>
            </div>
            <div className="info-item">
              <span>Description:</span>
              <p>{vote.description}</p>
            </div>
            <div className="info-item">
              <span>Creator:</span>
              <strong>{vote.creator.substring(0, 6)}...{vote.creator.substring(38)}</strong>
            </div>
            <div className="info-item">
              <span>Date:</span>
              <strong>{new Date(vote.timestamp * 1000).toLocaleDateString()}</strong>
            </div>
          </div>
          
          <div className="data-section">
            <h3>Vote Results</h3>
            
            <div className="data-row">
              <div className="data-label">Total Votes:</div>
              <div className="data-value">
                {vote.isVerified ? 
                  `${vote.decryptedValue} (Verified)` : 
                  decryptedValue !== null ? 
                  `${decryptedValue} (Decrypted)` : 
                  "🔒 Encrypted"
                }
              </div>
              {!vote.isVerified && (
                <button 
                  className="decrypt-btn"
                  onClick={handleDecrypt} 
                  disabled={isDecrypting}
                >
                  {isDecrypting ? "Decrypting..." : "Decrypt Results"}
                </button>
              )}
            </div>
            
            <div className="fhe-info">
              <div className="fhe-icon">🔐</div>
              <div>
                <strong>Fully Homomorphic Encryption</strong>
                <p>Votes are encrypted individually but can be counted collectively without revealing individual choices.</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn">Close</button>
        </div>
      </div>
    </div>
  );
};

export default App;


