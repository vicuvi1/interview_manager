"""Interview status state machine.

    requested ──approve──► approved ──schedule──► scheduled ──start──► in_progress ──complete──► completed
        │                     │                       │                     │
        ├──reject──► rejected │                       │                     │
        └──cancel──► cancelled└──cancel/reject─►       └──cancel─►           └──cancel─►  cancelled
"""

from .models import InterviewStatus

ALLOWED: dict[InterviewStatus, set[InterviewStatus]] = {
    InterviewStatus.REQUESTED: {
        InterviewStatus.APPROVED,
        InterviewStatus.REJECTED,
        InterviewStatus.CANCELLED,
    },
    InterviewStatus.APPROVED: {
        InterviewStatus.SCHEDULED,
        InterviewStatus.REJECTED,
        InterviewStatus.CANCELLED,
    },
    InterviewStatus.SCHEDULED: {
        InterviewStatus.IN_PROGRESS,
        InterviewStatus.CANCELLED,
    },
    InterviewStatus.IN_PROGRESS: {
        InterviewStatus.COMPLETED,
        InterviewStatus.CANCELLED,
    },
    InterviewStatus.COMPLETED: set(),
    InterviewStatus.REJECTED: set(),
    InterviewStatus.CANCELLED: set(),
}


class InvalidTransition(Exception):
    def __init__(self, current: InterviewStatus, target: InterviewStatus) -> None:
        self.current = current
        self.target = target
        super().__init__(
            f"Cannot move interview from '{current.value}' to '{target.value}'."
        )


def can_transition(current: InterviewStatus, target: InterviewStatus) -> bool:
    return target in ALLOWED.get(current, set())


def ensure_transition(current: InterviewStatus, target: InterviewStatus) -> None:
    if not can_transition(current, target):
        raise InvalidTransition(current, target)
