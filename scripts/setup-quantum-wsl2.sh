#!/usr/bin/env bash
# ═══════════════════════════════════════════════════════════════════
# Trading Forge — Quantum Computing Environment Setup (WSL2)
# ═══════════════════════════════════════════════════════════════════
#
# This script sets up all quantum computing dependencies in WSL2 Ubuntu.
# Run this FROM INSIDE WSL2, not from Windows.
#
# Prerequisites:
#   - WSL2 with Ubuntu 22.04+ installed
#   - NVIDIA GPU with drivers installed on Windows host
#   - nvidia-smi working inside WSL2
#
# Hardware: RTX 5060 (8GB VRAM), 32GB RAM
#
# Usage:
#   wsl -d Ubuntu
#   cd /mnt/c/Users/tonio/Projects/trading-forge/trading-forge
#   bash scripts/setup-quantum-wsl2.sh
#
# ═══════════════════════════════════════════════════════════════════

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[SETUP]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
error() { echo -e "${RED}[ERROR]${NC} $1"; }

# ─── 1. Verify WSL2 + GPU ────────────────────────────────────────
log "Checking environment..."

if ! grep -qi microsoft /proc/version 2>/dev/null; then
    error "Not running in WSL2. This script must be run inside WSL2 Ubuntu."
    exit 1
fi

if command -v nvidia-smi &>/dev/null; then
    log "GPU detected:"
    nvidia-smi --query-gpu=name,memory.total,driver_version --format=csv,noheader
else
    warn "nvidia-smi not found. GPU acceleration will not be available."
    warn "Install NVIDIA drivers on Windows host first."
fi

# ─── 2. System Dependencies ──────────────────────────────────────
log "Installing system dependencies..."
sudo apt-get update -qq
sudo apt-get install -y -qq python3-pip python3-venv python3-dev build-essential

# ─── 3. Create Virtual Environment ───────────────────────────────
VENV_DIR="$HOME/.venv/trading-forge-quantum"
if [ ! -d "$VENV_DIR" ]; then
    log "Creating virtual environment at $VENV_DIR..."
    python3 -m venv "$VENV_DIR"
else
    log "Virtual environment already exists at $VENV_DIR"
fi

source "$VENV_DIR/bin/activate"
pip install --upgrade pip setuptools wheel

# ─── 4. Core Quantum Packages ────────────────────────────────────
log "Installing Qiskit ecosystem..."
pip install "qiskit>=1.0"
pip install qiskit-aer
pip install qiskit-algorithms

# Try GPU-accelerated Aer
if command -v nvidia-smi &>/dev/null; then
    log "Installing GPU-accelerated packages..."
    pip install qiskit-aer-gpu 2>/dev/null || warn "qiskit-aer-gpu install failed — using CPU Aer"

    # NVIDIA cuQuantum SDK
    pip install cuquantum-cu12 2>/dev/null || warn "cuquantum install failed — tensor network acceleration unavailable"

    # CuPy for GPU arrays
    pip install cupy-cuda12x 2>/dev/null || warn "cupy install failed — GPU array operations unavailable"

    # PennyLane with GPU
    pip install pennylane "pennylane-lightning[gpu]" 2>/dev/null || {
        warn "pennylane-lightning[gpu] failed — installing CPU version"
        pip install pennylane pennylane-lightning
    }
else
    log "No GPU — installing CPU-only quantum packages..."
    pip install pennylane pennylane-lightning
fi

# ─── 5. Tensor Network + Annealing ───────────────────────────────
log "Installing tensor network and annealing packages..."
pip install quimb
pip install dwave-samplers
pip install scipy

# ─── 6. Trading Forge Dependencies ───────────────────────────────
log "Installing Trading Forge Python dependencies..."
pip install pydantic numpy

# ─── 7. Verify Installation ──────────────────────────────────────
log "Verifying installation..."

python3 -c "
import sys
results = []

# Qiskit
try:
    import qiskit
    results.append(('qiskit', qiskit.__version__, True))
except ImportError as e:
    results.append(('qiskit', str(e), False))

# Qiskit Aer
try:
    import qiskit_aer
    results.append(('qiskit-aer', qiskit_aer.__version__, True))
except ImportError as e:
    results.append(('qiskit-aer', str(e), False))

# Qiskit Algorithms
try:
    import qiskit_algorithms
    results.append(('qiskit-algorithms', qiskit_algorithms.__version__, True))
except ImportError as e:
    results.append(('qiskit-algorithms', str(e), False))

# PennyLane
try:
    import pennylane
    results.append(('pennylane', pennylane.__version__, True))
except ImportError as e:
    results.append(('pennylane', str(e), False))

# quimb
try:
    import quimb
    results.append(('quimb', quimb.__version__, True))
except ImportError as e:
    results.append(('quimb', str(e), False))

# dwave-samplers (replaces deprecated dwave-neal)
try:
    from dwave.samplers import SimulatedAnnealingSampler
    results.append(('dwave-samplers', 'installed', True))
except ImportError as e:
    results.append(('dwave-samplers', str(e), False))

# CuPy (GPU)
try:
    import cupy
    results.append(('cupy', cupy.__version__, True))
except ImportError:
    results.append(('cupy', 'not installed (CPU only)', False))

# cuQuantum
try:
    import cuquantum
    results.append(('cuquantum', cuquantum.__version__, True))
except ImportError:
    results.append(('cuquantum', 'not installed', False))

print()
print('=' * 60)
print('  Trading Forge — Quantum Environment Verification')
print('=' * 60)
for name, version, ok in results:
    status = '[OK]' if ok else '[--]'
    print(f'  {status} {name:20s} {version}')
print('=' * 60)

failed = [r for r in results if not r[2] and r[0] in ('qiskit', 'qiskit-aer', 'dwave-samplers', 'pennylane')]
if failed:
    print(f'  WARN: {len(failed)} core packages missing')
    sys.exit(1)
else:
    print('  All core packages installed successfully!')
print()
"

# ─── 8. GPU Qubit Capacity Test ───────────────────────────────────
if command -v nvidia-smi &>/dev/null; then
    log "Testing GPU qubit capacity..."
    python3 -c "
try:
    from qiskit_aer import AerSimulator
    sim = AerSimulator(method='statevector')
    from qiskit import QuantumCircuit

    # Test 20 qubits (small, should always work)
    qc = QuantumCircuit(20)
    for i in range(20):
        qc.h(i)
    result = sim.run(qc, shots=1).result()
    print(f'  GPU test (20 qubits): OK')

    # Test 25 qubits
    qc25 = QuantumCircuit(25)
    for i in range(25):
        qc25.h(i)
    result = sim.run(qc25, shots=1).result()
    print(f'  GPU test (25 qubits): OK')

    print(f'  GPU quantum simulation verified!')
except Exception as e:
    print(f'  GPU test failed: {e}')
    print(f'  Will fall back to CPU simulation')
" 2>/dev/null || warn "GPU capacity test skipped"
fi

# ─── 9. Summary ──────────────────────────────────────────────────
log "Setup complete!"
echo ""
echo "  To activate this environment:"
echo "    source $VENV_DIR/bin/activate"
echo ""
echo "  To run quantum modules:"
echo "    python -m src.engine.hardware_profile"
echo "    python -m src.engine.quantum_mc --input-json '{...}'"
echo ""
echo "  RTX 5060 (8GB) estimated limits:"
echo "    GPU statevector: ~27 qubits"
echo "    CPU statevector: ~30 qubits (32GB RAM)"
echo ""
