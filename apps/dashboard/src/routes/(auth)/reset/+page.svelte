<script lang="ts">
  import { onMount, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { resolve } from '$app/paths';
  import { page } from '$app/state';
  import { getConfirmPasswordError } from '$lib/utils/functions/validator';
  import { AuthUI } from '$features/ui';
  import { resetApi } from '$features/auth/api/reset.svelte';
  import type { TResetPasswordForm } from '$features/auth/utils/types';
  import { snackbar } from '$features/ui/snackbar/store';
  import * as Field from '@cio/ui/base/field';
  import { Password } from '@cio/ui/custom/password';
  import { Button } from '@cio/ui/base/button';
  import * as Card from '@cio/ui/base/card';

  let fields: TResetPasswordForm = $state({
    password: '',
    confirmPassword: '',
    token: ''
  });

  const isSubmitDisabled = $derived!(
    fields.password && fields.confirmPassword && fields.password !== fields.confirmPassword
  );
  const token = $derived(new URLSearchParams(page.url.search).get('token'));

  onMount(() => {
    if (token) return;

    snackbar.error('Enlace inválido o vencido');

    setTimeout(() => {
      goto(resolve('/login', {}));
    }, 2000);
  });

  function setConfirmPasswordError(fields: TResetPasswordForm) {
    untrack(() => {
      const errors = { ...resetApi.errors };
      errors.confirmPassword = getConfirmPasswordError(fields) ?? '';
      resetApi.setError(errors);
    });
  }

  $effect(() => {
    setConfirmPasswordError(fields);
  });
</script>

<svelte:head>
  <title>Nueva contraseña</title>
</svelte:head>

<AuthUI
  isLogin={false}
  handleSubmit={() => resetApi.submit({ ...fields, token: token ?? '' })}
  showOnlyContent={true}
  isLoading={resetApi.isLoading}
  showLogo={true}
>
  <div class="ui:flex ui:flex-col ui:gap-6">
    <div>
      <Card.Title class="ui:text-xl">Nueva contraseña</Card.Title>
      <Card.Description class="ui:mt-2">Ingresá tu nueva contraseña</Card.Description>
    </div>
    <Field.Field>
      <Field.Label for="password">Contraseña</Field.Label>
      <Field.Content>
        <Password
          id="password"
          bind:value={fields.password}
          placeholder="************"
          disabled={resetApi.isLoading}
          aria-invalid={resetApi.errors.password ? 'true' : undefined}
          autocomplete="new-password"
        />
        {#if resetApi.errors.password}
          <Field.Error>{resetApi.errors.password}</Field.Error>
        {/if}
        <Field.Description>La contraseña debe tener más de 8 caracteres</Field.Description>
      </Field.Content>
    </Field.Field>

    <Field.Field>
      <Field.Label for="confirmPassword">Confirmar contraseña</Field.Label>
      <Field.Content>
        <Password
          id="confirmPassword"
          bind:value={fields.confirmPassword}
          placeholder="************"
          disabled={resetApi.isLoading}
          aria-invalid={resetApi.errors.confirmPassword ? 'true' : undefined}
          autocomplete="new-password"
        />
        {#if resetApi.errors.confirmPassword}
          <Field.Error>{resetApi.errors.confirmPassword}</Field.Error>
        {/if}
      </Field.Content>
    </Field.Field>

    <Button
      type="submit"
      disabled={isSubmitDisabled || resetApi.isLoading}
      loading={resetApi.isLoading}
      class="ui:w-full"
    >
      Cambiar contraseña
    </Button>
  </div>
</AuthUI>
