from .comm import CommManager


class MockKernel:
    def __init__(self):
        self.comm_manager = CommManager()


kernel = MockKernel()
