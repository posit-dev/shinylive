"""Mock ipykernel"""

__version__ = "6.99.0"
__all__ = (
    "Comm",
    "CommManager",
    "__version__",
)

from .comm import Comm, CommManager
