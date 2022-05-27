"""Mock ipykernel"""

__version__ = "6.99.0"
__all__ = (
    "__version__",
    "Comm",
    "CommManager",
    "kernel",
)

from .comm import Comm, CommManager
from .kernel import kernel
