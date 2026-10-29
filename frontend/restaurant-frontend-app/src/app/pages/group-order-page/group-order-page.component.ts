import { CurrencyPipe, DatePipe } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { forkJoin } from 'rxjs';
import { ParticipantCardComponent } from '@app/components/group-orders/participant-card/participant-card.component';
import {
  GroupReservationStatus,
  GroupStatusResponse,
} from '@app/models/group-orders/group-status.model';
import { GroupSessionsResponse } from '@app/models/group-orders/group-sessions-response.model';
import { GuestInvite } from '@app/models/reservations/guest-invite.model';
import { consolidatePreOrder } from '@app/shared/helpers/consolidate-pre-order';
import { ModalComponent } from '@app/shared/custom-components/modal/modal.component';
import { GroupOrdersService } from '@app/services/group-orders/group-orders.service';
import { ToastService } from '@app/services/toast/toast.service';

@Component({
  standalone: true,
  selector: 'app-group-order-page',
  imports: [CurrencyPipe, DatePipe, ModalComponent, ParticipantCardComponent],
  templateUrl: './group-order-page.component.html',
  styleUrl: './group-order-page.component.scss',
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class GroupOrderPageComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly groupOrdersService = inject(GroupOrdersService);
  private readonly toastService = inject(ToastService);
  private readonly reservationId = this.route.snapshot.paramMap.get('reservationId') ?? '';

  readonly participants = signal<GroupSessionsResponse['participants']>([]);
  readonly invite = signal<GuestInvite | null>(null);
  readonly ownerSessionId = signal<string | null>(null);
  readonly groupStatus = signal<GroupReservationStatus>('Open');
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly submitDialogOpen = signal(false);
  readonly submitting = signal(false);

  readonly consolidatedOrder = computed(() => consolidatePreOrder(this.participants()));
  readonly pendingCount = computed(
    () => this.participants().filter((participant) => !participant.isSubmitted).length
  );
  readonly guestCount = computed(
    () => this.groupStatusResponse()?.currentParticipants ?? this.participants().length
  );
  readonly isReadOnly = computed(() => this.groupStatus() !== 'Open');
  readonly statusLabel = computed(() =>
    this.groupStatus() === 'Submitted'
      ? 'Sent to Restaurant'
      : this.groupStatus() === 'Open'
        ? 'Collecting pre-orders'
        : 'Closed'
  );
  readonly hasAnyDishes = computed(() =>
    this.participants().some((participant) => participant.items.length > 0)
  );

  private readonly groupStatusResponse = signal<GroupStatusResponse | null>(null);

  ngOnInit(): void {
    this.loadGroupOrder();
  }

  loadGroupOrder(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.invite.set(null);
    this.participants.set([]);
    this.ownerSessionId.set(null);
    this.groupStatusResponse.set(null);

    this.groupOrdersService
      .getGroupInvite$(this.reservationId)
      .subscribe({
        next: (invite) => {
          this.invite.set(invite);
          forkJoin({
            sessions: this.groupOrdersService.getSessions$(invite.GroupReservationId),
            ownerSessionId: this.groupOrdersService.getOwnerSessionId$(this.reservationId),
            status: this.groupOrdersService.getStatus$(invite.GroupReservationId),
          }).subscribe({
            next: ({ sessions, ownerSessionId, status }) => {
              this.participants.set(sessions.participants);
              this.ownerSessionId.set(ownerSessionId);
              this.groupStatus.set(status.status);
              this.groupStatusResponse.set(status);
              this.loading.set(false);
            },
            error: (error: unknown) => this.setLoadError(error),
          });
        },
        error: (error: unknown) => this.setLoadError(error),
      });
  }

  openSubmitDialog(): void {
    if (this.canSubmit()) {
      this.submitDialogOpen.set(true);
    }
  }

  closeSubmitDialog(): void {
    if (!this.submitting()) {
      this.submitDialogOpen.set(false);
    }
  }

  submitPreOrder(): void {
    const invite = this.invite();
    if (!invite || !this.canSubmit()) {
      return;
    }

    this.submitting.set(true);
    this.groupOrdersService.submit$(invite.GroupReservationId, this.reservationId).subscribe({
      next: () => {
        this.groupStatus.set('Submitted');
        this.submitDialogOpen.set(false);
        this.toastService.success('Pre-order sent to the restaurant');
      },
      error: () => {
        this.submitting.set(false);
        this.submitDialogOpen.set(false);
      },
      complete: () => this.submitting.set(false),
    });
  }

  canSubmit(): boolean {
    return (
      !this.loading() &&
      !this.loadError() &&
      !this.isReadOnly() &&
      !this.submitting() &&
      this.consolidatedOrder().items.length > 0
    );
  }

  private setLoadError(error: unknown): void {
    this.loading.set(false);
    this.loadError.set(
      error instanceof HttpErrorResponse && error.status === 404
        ? 'Group reservation not found'
        : 'Unable to load group reservation.'
    );
  }
}
