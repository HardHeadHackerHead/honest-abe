-- Neovide clipboard integration for Abe. Load from your Neovim configuration.
-- Ctrl+V remains Vim's literal-input / visual-block key.
if vim.g.neovide then
  vim.keymap.set({ "n", "i", "x", "c", "t" }, "<C-S-v>", function()
    vim.api.nvim_paste(vim.fn.getreg("+"), true, -1)
  end, { silent = true, desc = "Paste system clipboard (Abe / Neovide)" })

  vim.keymap.set("x", "<C-S-c>", '"+y', {
    silent = true,
    desc = "Copy selection to system clipboard (Abe / Neovide)",
  })
end
